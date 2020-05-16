const fs = require('fs')

let nextFile = true
let nextFileNumber = 1
let videosData = []
while (nextFile) {
    const path = `framesProcessed/#${nextFileNumber}increaseVideo.json`

    if (fs.existsSync(path)) {
        let videosDataFromFile = JSON.parse(fs.readFileSync(path))
        videosData = videosData.concat(videosDataFromFile)
        fs.unlinkSync(path)
        nextFileNumber++
    } else {
        nextFile = false
    }
}

fs.writeFile('framesProcessed/mergedIncreaseVideo.json', JSON.stringify(videosData), function (err, data) {
    console.log("merge done, with " + videosData.length + " videos")
})
