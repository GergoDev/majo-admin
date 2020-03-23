const axios = require('axios')
const youtubeChannels = require('./db').db().collection('channels')
const videos = require('./db').db().collection('videos')
const dotenv = require('dotenv')
dotenv.config()

function channelDataRequest(channelId, byId) {
  return new Promise((resolve, reject) => {

    let params

    if(byId) {
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
    }).then(function(response) {
        resolve(response.data)
    }).catch(function (error) {
        reject(error)
    })  
  })
}

function channelVideosRequest(channelId, fromDate) {
  return new Promise((resolve, reject) => {
    axios.get('https://www.googleapis.com/youtube/v3/search', {
        params: {
          part: "snippet",
          channelId: channelId,
          publishedAfter: fromDate,
          maxResults: 50,
          order: "date",
          key: process.env.YOUTUBEAPIKEY
        }
    }).then(function(response) {
        resolve(response.data)
    }).catch(function (error) {
        console.log("Error during channelVideosRequest ", error)
    })  
  })
}

async function addingChannelVideos(channelId, fromDate, channelName) {
  let {items: channelVideos} = await channelVideosRequest(channelId, fromDate)

  let videosToDatabase = channelVideos
    .filter(v => v.id.videoId && (new Date(v.snippet.publishedAt).getTime() !== new Date(fromDate).getTime()))
    .map( video => {
      return (
        {
          videoId: video.id.videoId,
          channelId: video.snippet.channelId,
          videoName: video.snippet.title,
          coverPic: video.snippet.thumbnails.high.url,
          releaseDate: video.snippet.publishedAt,
          addedDate: new Date()
        }
      )
  })

  let insertResult = await videos.insertMany(videosToDatabase)
  console.log(channelName, insertResult.insertedCount, "videos added")
  insertResult.ops.forEach( addedVideo => console.log("   ", addedVideo.videoName) )

}

async function addingChannels(channelList) {
  // Request channel data depending on identifier
  let channelsDataPromises = channelList.map( function(channelUrl) {
    if(channelUrl.indexOf("user/") != -1) {
      channelId = channelUrl.split("user/")[1]
      return channelDataRequest(channelId, false)
    }

    if(channelUrl.indexOf("channel/") != -1) {
      channelId = channelUrl.split("channel/")[1]
      return channelDataRequest(channelId, true)
    }
  })

  let channelsData = await Promise.all(channelsDataPromises)

  // Refactor data the way I want to store them
  let channelsDataToDatabase = channelsData.map( channelData => {
    return (
      {
        channelId: channelData.items[0].id,
        channelName: channelData.items[0].snippet.title,
        profilePic: channelData.items[0].snippet.thumbnails.medium.url,
        joinedDate: channelData.items[0].snippet.publishedAt,
        addedDate: new Date()
      }
    )
  })

  // Check if the channels already exist in database and take out existed ones.
  let channelIds = channelsDataToDatabase.map( c => c.channelId)
  let existedChannels = await youtubeChannels.find({ channelId: { $in: channelIds }}).toArray()
  channelsDataToDatabase = channelsDataToDatabase.filter( channel => !existedChannels.find( existedChannel => existedChannel.channelId === channel.channelId))
  
  if(existedChannels.length > 0) {
    console.log("This channel(s) already exist(s):")
    existedChannels.forEach( channel => console.log("  ", channel.channelName) )
  }

  if(channelsDataToDatabase.length != 0) {
    let insertResult = await youtubeChannels.insertMany(channelsDataToDatabase)
    console.log(insertResult.insertedCount, "channels added.")
    insertResult.ops.forEach( addedChannel => console.log("   ", addedChannel.channelName) )
    return channelsDataToDatabase
  } else {
    console.log("There is no added channels.")
    return null
  }
}

channelsToAdd = [
  "https://www.youtube.com/user/VideomaniaFCS",
  "https://www.youtube.com/channel/UCUMZ7gohGI9HcU9VNsr2FJQ",
  "https://www.youtube.com/channel/UCGoLa-QhHmTxLEdjv_8dxrg",
  "https://www.youtube.com/user/FlandyMusic",
  "https://www.youtube.com/channel/UCrcfRtdHb11YJEloTSaOYvw",
  "https://www.youtube.com/channel/UCYenDLnIHsoqQ6smwKXQ7Hg",
  "https://www.youtube.com/user/mattybikesguitars"
]

addingChannels(channelsToAdd).then( channelsAdded => {
  
  if(channelsAdded) {
    let currentDate = new Date()
    let twoMonthsBefore = currentDate.getTime() - (60*24*60*60*1000)
    let videosFrom = new Date(twoMonthsBefore)

    let addingVideosPromises = channelsAdded.map( channel => addingChannelVideos(channel.channelId, videosFrom, channel.channelName) )

    Promise.all(addingVideosPromises)
  }  

})
