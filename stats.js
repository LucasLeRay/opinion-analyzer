const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')

const adapter = new FileSync('db.json')
const db = low(adapter)
db.defaults({ sentiments: [], sinceId: 0 }).write()

function getAverage(arr) {
  return arr.reduce((a, b) => a + b) / arr.length
}

const stats = {
  positive: {
    avg: 0,
  },
  negative: {
    avg: 0,
  },
  neutral: {
    avg: 0,
  },
}

const sentiments = db.get('sentiments').value()
for (let i = 0; i < sentiments.length; i += 1) {
  stats.positive.avg = getAverage(
    sentiments.map(sentiment => sentiment.positive),
  )
  stats.negative.avg = getAverage(
    sentiments.map(sentiment => sentiment.negative),
  )
  stats.neutral.avg = getAverage(sentiments.map(sentiment => sentiment.neutral))
}

console.log(stats)
