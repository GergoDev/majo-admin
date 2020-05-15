const fs = require('fs')
const axios = require('axios')
const channels = require('./db').db().collection('channels')
const videos = require('./db').db().collection('videos')
const trendingDataFrames = require('./db').db().collection('trendingDataFrames')
const dotenv = require('dotenv')
dotenv.config()

async function trendingDataFramesRequest(props) {
  return await trendingDataFrames.find({ 
    dataFrameDate: { 
        $gt: props.dataFramesFrom,
        $lt: props.dataFramesTo
    }
  }).toArray()
}

async function videosWithDataFrames(props) {
  return new Promise( (resolve, reject) => {

    let channelIds = props.channelIds.length ? { channelId: { $in: props.channelIds}} : {}

    videos.aggregate([
      { $match: 
          {
              $and: [
                  { status: 'on' },
                  { releaseDate: { $gt: props.videosFrom,$lt: props.videosTo }},
                  { ...channelIds }
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
                { addedDate: { $lt: props.dataFramesFrom }}
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

  let n = n => n > 9 ? "" + n : "0" + n

  function tillHoursMillisecs(date) {
    date = new Date(date.setMinutes(00))
    date = new Date(date.setSeconds(00))
    date = new Date(date.setMilliseconds(000))
    return date.getTime()
  }

  let framesForVideosCalculated = videosFromMongo.map( video => {

    if(video.videoDataFrames.length != 0) {

        let frameCountCalculated = Math.floor(((dataFramesTo - dataFramesFrom) / frameDistance))
        let framesProcessed = {}
        let firstValueCount = 0
        let firstValueFound = false

        for(let x = 0; x <= frameCountCalculated; x++) {

          let actualFrameDate = new Date(dataFramesFrom.getTime() + (x * frameDistance))
          let days = ["va.", "hé.", "ke.", "sze.", "csü.", "pé.", "szo."]
          let frameDateStyled = `${actualFrameDate.getFullYear()}-${n(actualFrameDate.getMonth()+1)}-${n(actualFrameDate.getDate())} ${days[actualFrameDate.getDay()]} ${n(actualFrameDate.getHours())}:${n(actualFrameDate.getMinutes())}`
          let videoDataFrame = video.videoDataFrames.find( frame => tillHoursMillisecs(frame.dataFrameDate) == tillHoursMillisecs(actualFrameDate))
          let releaseDateMatch = tillHoursMillisecs(video.releaseDate) == tillHoursMillisecs(actualFrameDate)

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

        let videoName = (video.channelInfo[0].channelName + ": " + video.videoName).toUpperCase()
        let videoNameMaxLength = 50
        let videoModifier = modify.find( modifyElement => modifyElement.videoId == video.videoId)
        let toModify = (videoModifier) ? videoModifier.toModify : {}
        if(toModify.VideoName) {
          toModify.VideoName = toModify.VideoName.toUpperCase()
          if(toModify.VideoName.length > videoNameMaxLength)
            toModify.VideoName = toModify.VideoName.slice(0, videoNameMaxLength).trim()+"..."
        }

        return {
          VideoName: (videoName.length > videoNameMaxLength) ? videoName.slice(0, videoNameMaxLength).trim()+"..." : videoName,
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
  let { indicator, videosFromPreviousTime, dataFramesFrom, dataFramesTo, frameDistance, channelIds, modify } = props
  let videosFrom = new Date(dataFramesFrom.getTime() - videosFromPreviousTime)
  let videosTo = dataFramesTo
  let videosFromMongo = await videosWithDataFrames({ videosFrom, videosTo, dataFramesFrom, dataFramesTo, channelIds })
  
  return await videoIncreaseProcessor({ videosFromMongo, indicator, dataFramesFrom, dataFramesTo, frameDistance, modify })
}

async function channelIncreaseProcessor(props) {

  let { channelsFromMongo, indicator, dataFramesFrom, dataFramesTo, frameDistance, modify } = props  

  let n = n => n > 9 ? "" + n : "0" + n

  function tillHoursMillisecs(date) {
    date = new Date(date.setMinutes(00))
    date = new Date(date.setSeconds(00))
    date = new Date(date.setMilliseconds(000))
    return date.getTime()
  }

  let framesForChannelsCalculated = channelsFromMongo.map( channel => {

    if(channel.dataFrames.length != 0) {

        let frameCountCalculated = Math.floor(((dataFramesTo - dataFramesFrom) / frameDistance))
        let framesProcessed = {}
        let firstValueCount = 0
        let firstValueFound = false

        for(let x = 0; x <= frameCountCalculated; x++) {

          let actualFrameDate = new Date(dataFramesFrom.getTime() + (x * frameDistance))
          let days = ["va.", "hé.", "ke.", "sze.", "csü.", "pé.", "szo."]
          let frameDateStyled = `${actualFrameDate.getFullYear()}-${n(actualFrameDate.getMonth()+1)}-${n(actualFrameDate.getDate())} ${days[actualFrameDate.getDay()]} ${n(actualFrameDate.getHours())}:${n(actualFrameDate.getMinutes())}`
          let channelDataFrame = channel.dataFrames.find( frame => tillHoursMillisecs(frame.dataFrameDate) == tillHoursMillisecs(actualFrameDate))

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
        let channelNameMaxLength = 30
        let channelModifier = modify.find( modifyElement => modifyElement.channelId == channel.channelId)
        let toModify = (channelModifier) ? channelModifier.toModify : {}
        if(toModify.ChannelName && toModify.ChannelName.length > channelNameMaxLength) {
          toModify.ChannelName = toModify.ChannelName.slice(0, channelNameMaxLength).trim()+"..."
        }

        return {
          ChannelName: (channelName.length > channelNameMaxLength) ? channelName.slice(0, channelNameMaxLength).trim()+"..." : channelName,
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
  let { indicator, dataFramesFrom, dataFramesTo, frameDistance, modify } = props
  let channelsFromMongo = await channelsWithDataFrames({ dataFramesFrom, dataFramesTo})

  return await channelIncreaseProcessor({ channelsFromMongo, indicator, dataFramesFrom, dataFramesTo, frameDistance, modify })
}

async function trendingProcessor(props) {

  let { trendingDataFromMongo, dataFramesFrom, dataFramesTo, frameDistance } = props  

  let n = n => n > 9 ? "" + n : "0" + n

  function tillMinutesMillisecs(date) {
    date = new Date(date.setSeconds(00))
    date = new Date(date.setMilliseconds(000))
    return date.getTime()
  }

  let notUniqueVideos = []
  trendingDataFromMongo.forEach( trendingPack => trendingPack.rankedVideos.forEach( video => notUniqueVideos.push(video)))
  let uniqueVideos = notUniqueVideos.filter( (video, index) => notUniqueVideos.findIndex( findVideo => video.videoId == findVideo.videoId) == index )

  let videoFramesCalculated = uniqueVideos.map( uniqueVideo => {

        let frameCountCalculated = Math.floor(((dataFramesTo - dataFramesFrom) / frameDistance))
        let framesProcessed = {}
        let prevRank = 1000

        for(let x = 0; x <= frameCountCalculated; x++) {

          let actualFrameDate = new Date(dataFramesFrom.getTime() + (x * frameDistance))
          let days = ["va.", "hé.", "ke.", "sze.", "csü.", "pé.", "szo."]
          let frameDateStyled = `${actualFrameDate.getFullYear()}-${n(actualFrameDate.getMonth()+1)}-${n(actualFrameDate.getDate())} ${days[actualFrameDate.getDay()]} ${n(actualFrameDate.getHours())}:${n(actualFrameDate.getMinutes())}`
          let dataFrameMatch = trendingDataFromMongo.find( frame => tillMinutesMillisecs(frame.dataFrameDate) == tillMinutesMillisecs(actualFrameDate))

          if(dataFrameMatch) {

            let videoRank = dataFrameMatch.rankedVideos.findIndex( video => video.videoId == uniqueVideo.videoId)

            if(videoRank != -1) {
              videoRank = 100 + (videoRank * 2)
              framesProcessed[frameDateStyled] = videoRank
              prevRank = videoRank
            } else {
              framesProcessed[frameDateStyled] = 1000
            }

          } else {
            framesProcessed[frameDateStyled] = prevRank
          }
          
        }

        let videoName = uniqueVideo.videoName
        let videoNameMaxLength = 78

        return {
          VideoName: (videoName.length > videoNameMaxLength) ? videoName.slice(0, videoNameMaxLength).trim()+"..." : videoName,
          videoId: uniqueVideo.videoId, 
          ProfilePic: uniqueVideo.coverPic, 
          ...framesProcessed,        
        }
    
  })
  return videoFramesCalculated
}

async function trendingDataFramesProcessing(props) {
  let { dataFramesFrom, dataFramesTo, frameDistance } = props

  let trendingDataFromMongo = await trendingDataFramesRequest({ dataFramesFrom, dataFramesTo })

  return await trendingProcessor({ trendingDataFromMongo, dataFramesFrom, dataFramesTo, frameDistance })
}




// channelsToAdd = [
//   ""  
// ]

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
//   videoId: "K4wkIYswAg8",
//   toModify: {
//     VideoName: "unfield: csalo",
//     Thumbnail: "http://image.com/image.png",
//     Remove: true
//   }
// }
// indicator could be: viewCount, likeCount, dislikeCount, commentCount
videoDataFramesProcessing({
  indicator: "viewCount",
  videosFromPreviousTime: 7 * 24 * 60 * 60 * 1000,
  dataFramesFrom: new Date("2020-05-10T00:00:00.000+0100"),
  dataFramesTo: new Date("2020-05-11T00:00:30.000+0100"),
  frameDistance: 60 * 60 * 1000,
  channelIds: [],
  modify: [

  ]
}).then( res => {
  let fileName = "increaseVideo.json"
  fs.writeFile("framesProcessed/" + fileName, JSON.stringify(res), err => {
    if(err) throw err
    console.log(fileName + ", Saved!")
  })
})

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
// indicator could be: viewCount, subscribersCount, videoCount
// channelDataFramesProcessing({
//   indicator: "viewCount",
//   dataFramesFrom: new Date("2020-04-16T00:00:00.000+0100"),
//   dataFramesTo: new Date("2020-04-22T16:00:30.000+0100"), 
//   frameDistance: 60 * 60 * 1000,
//   modify: [
    
//   ]
// }).then( res => {
//   let fileName = "increaseChannel.json"
//   fs.writeFile("framesProcessed/" + fileName, JSON.stringify(res), err => {
//     if(err) throw err
//     console.log(fileName + ", Saved!")
//   })  
// })

// ************************************************************************************************
// trendingDataFramesProcessing(
//   {
//     dataFramesFrom: new Date("2020-04-10T00:00:00.000+0100"),
//     dataFramesTo: new Date("2020-05-14T16:00:30.000+0100"),
//     frameDistance: 24 * 60 * 60 * 1000
//   }
// ).then( res => {
//   let fileName = "trendingVideos.json"
//   fs.writeFile("framesProcessed/" + fileName, JSON.stringify(res), err => {
//     if(err) throw err
//     console.log(fileName + ", Saved!")
//   })
// })