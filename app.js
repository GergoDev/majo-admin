const axios = require('axios')
const videoDataFrames = require('./db').db().collection('videoDataFrames')
const youtubeChannels = require('./db').db().collection('youtubeChannels')
const videos = require('./db').db().collection('videos')
const schedule = require('node-schedule')
const dotenv = require('dotenv')
dotenv.config()


videoId = "WxAPsQ7TUaQ"

function videoStatRequest(videoId) {
  return new Promise((resolve, reject) => {
    axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: {
          part: "statistics",
          id: videoId,
          key: process.env.YOUTUBEAPIKEY
        }
    }).then(function(response) {
        resolve(response.data.items[0].statistics)
    }).catch(function (error) {
        reject(error)
    })  
  })
}

// var j = schedule.scheduleJob('*/5 * * * * *', async function(){

//   const {viewCount, likeCount, dislikeCount, commentCount} = await videoStatRequest(videoId)

//   videoDataFrames.insertOne({
//     videoId, 
//     channelId: "channelId", 
//     dataFrameDate: new Date(), 
//     viewCount, 
//     likeCount, 
//     dislikeCount, 
//     commentCount
//   }, () => console.log("Insert done, Ready"))

// })

// function channelDataRequest(channelId) {
//   return new Promise((resolve, reject) => {
//     axios.get('https://www.googleapis.com/youtube/v3/channels', {
//         params: {
//           part: "snippet",
//           id: channelId,
//           key: process.env.YOUTUBEAPIKEY
//         }
//     }).then(function(response) {
//         resolve(response.data.items[0].snippet)
//     }).catch(function (error) {
//         reject(error)
//     })  
//   })
// }

// channelId = "UCVoGCDIv8h3OkzZYySWK6lw"

// channelDataRequest(channelId).then((response) => {

//   youtubeChannels.insertOne({
//     channelId,
//     channelName: response.title,
//     joinedDate: response.publishedAt,
//     addedDate: new Date(),
//     profilePic: response.thumbnails.medium.url
//   }, () => console.log("Insert done, Ready"))

// })

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

async function addingChannelVideos(channelId, fromDate) {
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

  console.log(videosToDatabase)
  // await videos.insertMany(videosToDatabase)
  //   .then(() => console.log(`${new Date()} - ${videosToDatabase.length} videos added`))
  //   .catch(error => console.log(error))
}

channelId = "UCzGOSLOfec9FpSfBuJGwWkg"
let currentDate = new Date()
let twoMonthsBefore = currentDate.getTime() - (60*24*60*60*1000)
let videosFrom = new Date(twoMonthsBefore)
addingChannelVideos(channelId, '2020-03-08T12:58:02.000Z')