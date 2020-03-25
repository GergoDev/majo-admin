function channelUploadsRequest(playlistId) {
    return new Promise((resolve, reject) => {
      axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
        params: {
          part: "snippet,contentDetails",
          playlistId,
          maxResults: 50,
          key: process.env.YOUTUBEAPIKEY
        }
      }).then(function (response) {
        resolve(response.data)
      }).catch(function (error) {
        console.log("Error during channelVideosRequest ", error)
      })
    })
  }
  
  channelUploadsRequest("UUeAB8_SpJPf-xLP4VqHk6TQ").then(res => {
    console.log(res.pageInfo.totalResults)
    res.items.map((item, index) => console.log(index+1, item.snippet.title, item.snippet.publishedAt))
  })
  
  function channelVideosSearchRequest(channelId) {
    return new Promise((resolve, reject) => {
      axios.get('https://www.googleapis.com/youtube/v3/search', {
        params: {
          part: "snippet",
          channelId: channelId,
          maxResults: 50,
          order: "date",
          key: process.env.YOUTUBEAPIKEY
        }
      }).then(function (response) {
        resolve(response.data)
      }).catch(function (error) {
        console.log("Error during channelVideosRequest ", error)
      })
    })
  }
  channelVideosSearchRequest("UCeAB8_SpJPf-xLP4VqHk6TQ").then(res => {
    console.log(res.pageInfo.totalResults)
    res.items.map((item, index) => console.log(index+1, item.snippet.title, item.snippet.publishedAt))
  })