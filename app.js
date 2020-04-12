const fs = require('fs')
const axios = require('axios')
const channels = require('./db').db().collection('channels')
const videos = require('./db').db().collection('videos')
const dotenv = require('dotenv')
dotenv.config()

async function videosWithDataFrames(props) {
  return new Promise( (resolve, reject) => {

    videos.aggregate([
      { $match: 
          {
              $and: [
                  { status: 'on' },
                  { releaseDate: { $gt: props.videosFrom,$lt: props.videosTo }}
              ]
          }
      },
      { $lookup: 
          {
              from: "videoDataFrames",
              let: { videoId: "$videoId"},
              pipeline: [
                   { $match:
                       { $expr:
                           { $and:
                               [
                                  { $eq: ["$videoId", "$$videoId" ] },
                                  { $gte: ["$dataFrameDate", props.dataFramesFrom ] },
                                  { $lte: ["$dataFrameDate", props.dataFramesTo ] }
                               ]
                           }
                       }
                   },
                   { $sort: { dataFrameDate: 1 } }
               ],
               as: "videoDataFrames"
          }
      },
      {$lookup: 
          {
              from: "channels",
              localField: "channelId",
              foreignField: "channelId",
              as: "channelInfo"
          }
      }
    ]).toArray( (err, res) => resolve(res) )

  })
}

async function channelsWithDataFrames(props) {
  return await channels.aggregate([
    { $match: 
        {
            $and: [
                { status: 'on' },
                { addedDate: { $lt: props.channelsFrom }}
            ]
        }
    },
    { $lookup: 
        {
            from: "channelDataFrames",
            let: { channelId: "$channelId"},
            pipeline: [
                { $match:
                    { $expr:
                        { $and:
                            [
                                { $eq: ["$channelId", "$$channelId"] },
                                { $gte: ["$dataFrameDate", props.dataFramesFrom ] },
                                { $lte: ["$dataFrameDate", props.dataFramesTo ] }
                            ]
                        }
                    }
                },
                { $sort: { dataFrameDate: 1 } }
            ],
            as: "dataFrames"
        }
    }
  ]).toArray()
}

function channelDataRequest(channelId, byId) {
  return new Promise((resolve, reject) => {

    let params

    if (byId) {
      params = {
        part: "snippet",
        id: channelId,
        key: process.env.YOUTUBEAPIKEY
      }
    } else {
      params = {
        part: "snippet",
        forUsername: channelId,
        key: process.env.YOUTUBEAPIKEY
      }
    }

    axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params
    }).then(function (response) {
      resolve(response.data)
    }).catch(function (error) {
      reject(error)
    })
  })
}

function channelActivityRequest(channelId, fromDate) {
  return new Promise((resolve, reject) => {
    axios.get('https://www.googleapis.com/youtube/v3/activities', {
      params: {
        part: "snippet,contentDetails",
        channelId: channelId,
        publishedAfter: fromDate,
        maxResults:50,
        key: process.env.YOUTUBEAPIKEY
      }
    }).then(function (response) {
      resolve(response.data)
    }).catch(function (error) {
      console.log("!!!Error during channelActivityRequest!!!")
    })
  })
}

async function addingChannelVideos(channelId, fromDate, channelName) {
  let { items: channelVideos } = await channelActivityRequest(channelId, fromDate)

  let videosToDatabase = channelVideos
    .filter(v => (v.snippet.type === 'upload') && v.contentDetails.upload.videoId && (new Date(v.snippet.publishedAt).getTime() !== new Date(fromDate).getTime()))
    .map(video => {
      return (
        {
          videoId: video.contentDetails.upload.videoId,
          channelId: video.snippet.channelId,
          videoName: video.snippet.title,
          coverPic: video.snippet.thumbnails.high.url,
          category: "N/A",
          status: "on",
          releaseDate: new Date(video.snippet.publishedAt),
          addedDate: new Date()
        }
      )
    })

  if(videosToDatabase.length != 0) {
    let insertResult = await videos.insertMany(videosToDatabase)
    console.log(channelName, insertResult.insertedCount, "videos added")
    insertResult.ops.forEach(addedVideo => console.log("   ", addedVideo.videoName))
  } else {
    console.log(channelName, 0, "videos added")
  }

}

async function addingChannels(channelList) {
  // Request channel data depending on identifier
  let channelsDataPromises = channelList.map(function (channelUrl) {
    if (channelUrl.indexOf("user/") != -1) {
      channelId = channelUrl.split("user/")[1]
      return channelDataRequest(channelId, false)
    }

    if (channelUrl.indexOf("channel/") != -1) {
      channelId = channelUrl.split("channel/")[1]
      return channelDataRequest(channelId, true)
    }
  })

  let channelsData = await Promise.all(channelsDataPromises)

  // Refactor data the way I want to store them
  let channelsDataToDatabase = channelsData.map(channelData => {
    return (
      {
        channelId: channelData.items[0].id,
        channelName: channelData.items[0].snippet.title,
        profilePic: channelData.items[0].snippet.thumbnails.medium.url,
        category: "N/A",
        status: "on",
        joinedDate: new Date(channelData.items[0].snippet.publishedAt),
        addedDate: new Date()
      }
    )
  })

  // Check for duplications in channel list and take out duplicated ones.
  let channelIds = channelsDataToDatabase.map(c => c.channelId)
  channelsDataToDatabase = channelsDataToDatabase.filter( (channel, index) => channelIds.indexOf(channel.channelId) == index )

  // Check if the channels already exist in database and take out existed ones.
  let existedChannels = await channels.find({ channelId: { $in: channelIds } }).toArray()
  channelsDataToDatabase = channelsDataToDatabase.filter(channel => !existedChannels.find(existedChannel => existedChannel.channelId === channel.channelId))

  if (existedChannels.length > 0) {
    console.log("This channel(s) already exist(s):")
    existedChannels.forEach(channel => console.log("  ", channel.channelName))
  }

  if (channelsDataToDatabase.length != 0) {
    let insertResult = await channels.insertMany(channelsDataToDatabase)
    console.log(insertResult.insertedCount, "channels added.")
    insertResult.ops.forEach(addedChannel => console.log("   ", addedChannel.channelName))
    return channelsDataToDatabase
  } else {
    console.log("There is no added channels.")
    return null
  }
}

async function videoIncreaseProcessor(props) {

  let { videosFromMongo, indicator, dataFramesFrom, dataFramesTo, frameDistance, modify } = props  

  function n(n){
    return n > 9 ? "" + n: "0" + n;
  }

  function tillMinutesMillisecs(date) {
    return new Date(`${date.getFullYear()}-${n(date.getMonth()+1)}-${n(date.getDate())}T${n(date.getHours())}:${n(date.getMinutes())}:00.000Z`).getTime()
  }

  let framesForVideosCalculated = videosFromMongo.map( video => {

    if(video.videoDataFrames.length != 0) {

        let frameCountCalculated = Math.floor(((dataFramesTo - dataFramesFrom) / frameDistance))
        let framesProcessed = {}
        let firstValueCount = 0
        let firstValueFound = false

        for(let x = 0; x <= frameCountCalculated; x++) {

          let actualFrameDate = new Date(dataFramesFrom.getTime() + (x * frameDistance))
          let frameDateStyled = `${actualFrameDate.getFullYear()}-${n(actualFrameDate.getMonth()+1)}-${n(actualFrameDate.getDate())} ${n(actualFrameDate.getHours())}:${n(actualFrameDate.getMinutes())}`
          let videoDataFrame = video.videoDataFrames.find( frame => tillMinutesMillisecs(frame.dataFrameDate) == tillMinutesMillisecs(actualFrameDate))
          let releaseDateMatch = tillMinutesMillisecs(video.releaseDate) == tillMinutesMillisecs(actualFrameDate)

          if(videoDataFrame || releaseDateMatch) {
            if(firstValueFound) {
              framesProcessed[frameDateStyled] = videoDataFrame[indicator] - firstValueCount
            } else {
              framesProcessed[frameDateStyled] = 0
              firstValueCount = (releaseDateMatch) ? 0 : videoDataFrame[indicator]
              firstValueFound = true
            }
          } else {
            framesProcessed[frameDateStyled] = ""
          }
        }

        let videoName = video.channelInfo[0].channelName + ": " + video.videoName
        let videoModifier = modify.find( modifyElement => modifyElement.videoId == video.videoId)
        let toModify = (videoModifier) ? videoModifier.toModify : {}
        if(toModify.VideoName && toModify.VideoName.length > 50) {
          toModify.VideoName = toModify.VideoName.slice(0, 50)+"..."
        }

        return {
          VideoName: (videoName.length > 50) ? videoName.slice(0, 50)+"..." : videoName,
          VideoId: video.videoId, 
          Thumbnail: video.coverPic, 
          ...framesProcessed,
          ...toModify
        }
    }
  })
  
  return framesForVideosCalculated.filter( f => f && !f.Remove )
}

async function videoDataFramesProcessing(props) {
  let { indicator, videosFromPreviousTime, dataFramesFrom, dataFramesTo, frameDistance, modify } = props
  let videosFrom = new Date(dataFramesFrom.getTime() - videosFromPreviousTime)
  let videosTo = dataFramesTo
  let videosFromMongo = await videosWithDataFrames({ videosFrom, videosTo, dataFramesFrom, dataFramesTo })
  
  return await videoIncreaseProcessor({ videosFromMongo, indicator, dataFramesFrom, dataFramesTo, frameDistance, modify })
}

channelsToAdd = [
  "https://www.youtube.com/channel/UCGoLa-QhHmTxLEdjv_8dxrg",
  "https://www.youtube.com/channel/UC6Cvo-tOSuHGlILWlnBL2vA",
  "https://www.youtube.com/channel/UCeAB8_SpJPf-xLP4VqHk6TQ",
  "https://www.youtube.com/channel/UCKLkW1hXwv9603DsBw-s_vA",
  "https://www.youtube.com/channel/UCr8KinYuK1P903mOG_1qujg", 
  "https://www.youtube.com/channel/UC59r0LCCC1aoqNisdj-RE1w", 
  "https://www.youtube.com/channel/UC5Q1f1LK263xioqRjXEY8Lg" , 
  "https://www.youtube.com/channel/UC_qjsyBmS4sViRMMERAxl2g", 
  "https://www.youtube.com/channel/UCE7oC2iKBoXEoN2K96cjXyg", 
  "https://www.youtube.com/channel/UCbgbVUSZ2I6fAAHiWxfZoOQ", 
  "https://www.youtube.com/channel/UC7LxLbV1DLE2gSuVDfDOsIA", 
  "https://www.youtube.com/channel/UC4omgFhwkAKzdrYH2dyJNvQ", 
  "https://www.youtube.com/channel/UC_fwxj011v4ZCDKcV8U4rTw", 
  "https://www.youtube.com/channel/UCgP9ETA61mi7UwMbbkVsCSQ", 
  "https://www.youtube.com/channel/UCXpszjVK17Wf7jf4zLz5Nnw", 
  "https://www.youtube.com/channel/UC2I3zxy4XGqSDkJfQI0whyQ", 
  "https://www.youtube.com/channel/UCoXnnnrdhaKljuhA2IrIhVQ", 
  "https://www.youtube.com/channel/UCrFqWhglNIdjciMNNB9IW5w", 
  "https://www.youtube.com/channel/UCEz9c3Qv7mnZcjP4s2_WpMw", 
  "https://www.youtube.com/channel/UCDobqE_rsI0Xq2cg-Sy6CWg", 
  "https://www.youtube.com/channel/UCMEMunO_gYjW7FQhgAiHRhw", 
  "https://www.youtube.com/channel/UCipg-1LCecIfx8RfWnafG4Q", 
  "https://www.youtube.com/channel/UCRJovKcgUL7QumDE1YsLqzg",
  "https://www.youtube.com/channel/UCVoGCDIv8h3OkzZYySWK6lw"
]

// addingChannels(channelsToAdd).then(channelsAdded => {

//   if (channelsAdded) {
//     let currentDate = new Date()
//     let twoMonthsBefore = currentDate.getTime() - (60 * 24 * 60 * 60 * 1000)
//     let videosFrom = new Date(twoMonthsBefore)

//     let addingVideosPromises = channelsAdded.map(channel => addingChannelVideos(channel.channelId, videosFrom, channel.channelName))

//     Promise.all(addingVideosPromises)
//   }

// })

// ************************************************************************************************
// To modify a video frames output, create a modify object with the fields that you want to modify.
// {
//   videoId: "AzLij636Mss",
//   toModify: {
//     VideoName: "foo",
//     Thumbnail: "http://image.com/image.png",
//     Remove: true
//   }
// }
// indicator could be: viewCount, likeCount, dislikeCount, commentCount
videoDataFramesProcessing({
  indicator: "dislikeCount",
  videosFromPreviousTime: 7 * 24 * 60 * 60 * 1000,
  dataFramesFrom: new Date("2020-04-06T00:00:00.000+0100"),
  dataFramesTo: new Date("2020-04-12T00:01:00.000+0100"),
  frameDistance: 60 * 60 * 1000,
  modify: [
    
  ]
}).then( res => {
  let fileName = "ddd-" + new Date() + ".json"
  fs.writeFile("framesProcessed/videoDataFrames" + fileName, JSON.stringify(res), err => {
    if(err) throw err
    console.log(fileName + ", Saved!")
  })
})

async function channelIncreaseProcessor(props) {

  let { channelsFromMongo, indicator, dataFramesFrom, dataFramesTo, frameDistance, modify } = props  

  function n(n){
    return n > 9 ? "" + n: "0" + n;
  }

  function tillMinutesMillisecs(date) {
    return new Date(`${date.getFullYear()}-${n(date.getMonth()+1)}-${n(date.getDate())}T${n(date.getHours())}:${n(date.getMinutes())}:00.000Z`).getTime()
  }

  let framesForChannelsCalculated = channelsFromMongo.map( channel => {

    if(channel.dataFrames.length != 0) {

        let frameCountCalculated = Math.floor(((dataFramesTo - dataFramesFrom) / frameDistance))
        let framesProcessed = {}
        let firstValueCount = 0
        let firstValueFound = false

        for(let x = 0; x <= frameCountCalculated; x++) {

          let actualFrameDate = new Date(dataFramesFrom.getTime() + (x * frameDistance))
          let frameDateStyled = `${actualFrameDate.getFullYear()}-${n(actualFrameDate.getMonth()+1)}-${n(actualFrameDate.getDate())} ${n(actualFrameDate.getHours())}:${n(actualFrameDate.getMinutes())}`
          let channelDataFrame = channel.dataFrames.find( frame => tillMinutesMillisecs(frame.dataFrameDate) == tillMinutesMillisecs(actualFrameDate))

          if(channelDataFrame) {
            if(firstValueFound) {
              framesProcessed[frameDateStyled] = channelDataFrame[indicator] - firstValueCount
            } else {
              framesProcessed[frameDateStyled] = 0
              firstValueCount = channelDataFrame[indicator]
              firstValueFound = true
            }
          } else {
            framesProcessed[frameDateStyled] = ""
          }
        }

        let channelName = channel.channelName
        let channelModifier = modify.find( modifyElement => modifyElement.channelId == channel.channelId)
        let toModify = (channelModifier) ? channelModifier.toModify : {}
        if(toModify.ChannelName && toModify.ChannelName.length > 50) {
          toModify.ChannelName = toModify.ChannelName.slice(0, 50)+"..."
        }

        return {
          ChannelName: (channelName.length > 50) ? channelName.slice(0, 50)+"..." : channelName,
          ChannelId: channel.channelId, 
          ProfilePic: channel.profilePic, 
          ...framesProcessed,
          ...toModify
        }
    }
  })
  
  return framesForChannelsCalculated.filter( f => f && !f.Remove )
}

async function channelDataFramesProcessing(props) {
  let { indicator, channelsFrom, dataFramesFrom, dataFramesTo, frameDistance, modify } = props
  let channelsFromMongo = await channelsWithDataFrames({ channelsFrom, dataFramesFrom, dataFramesTo})

  return await channelIncreaseProcessor({ channelsFromMongo, indicator, dataFramesFrom, dataFramesTo, frameDistance, modify })
}

// ************************************************************************************************
// To modify a video frames output, create a modify object with the fields that you want to modify.
// {
//   channelId: "AzLij636Mss",
//   toModify: {
//     ChannelName: "foo",
//     ProfilePic: "http://image.com/image.png",
//     Remove: true
//   }
// }
// channelDataFramesProcessing({
//   indicator: "viewCount",
//   channelsFrom: new Date("2020-04-06T00:00:00.000+0100"),
//   dataFramesFrom: new Date("2020-04-06T00:00:00.000+0100"), 
//   dataFramesTo: new Date("2020-04-12T00:01:00.000+0100"), 
//   frameDistance: 60 * 60 * 1000,
//   modify: [
    
//   ]
// }).then( res => {
//   let fileName = "-" + new Date() + ".json"
//   fs.writeFile("framesProcessed/channelDataFrames/" + fileName, JSON.stringify(res), err => {
//     if(err) throw err
//     console.log(fileName + ", Saved!")
//   })  
// })