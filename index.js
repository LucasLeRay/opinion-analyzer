#!/usr/bin/env node

const dotenv = require('dotenv')
const AWS = require('aws-sdk')
const Twit = require('twit')
const minimist = require('minimist')
const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')

const args = minimist(process.argv.slice(2), {
  alias: {
    h: 'help',
    s: 'subject',
    t: 'tweets',
  },
})

if (!args.s) {
  console.error('No subject.')
  process.exit(1)
}

const dateObj = new Date()
const month = dateObj.getUTCMonth() + 1
const day = dateObj.getUTCDate()
const year = dateObj.getUTCFullYear()
const date = `${month}-${day}-${year}`
const adapter = new FileSync('db.json')
const db = low(adapter)
db.defaults({
  [args.s]: {
    [date]: {
      positive: 0,
      negative: 0,
      neutral: 0,
      count: 0,
    },
    sinceId: 0,
  },
}).write()
const entry = db
  .get(args.s)
  .get(date)
  .value()
if (!entry) {
  db.set(`${args.s}.${date}`, {
    positive: 0,
    negative: 0,
    neutral: 0,
    count: 0,
  }).write()
}

dotenv.config()

const comprehend = new AWS.Comprehend({
  apiVersion: '2017-11-27',
  region: 'eu-west-1',
})

const T = new Twit({
  consumer_key: process.env.CONSUMER_KEY,
  consumer_secret: process.env.CONSUMER_SECRET,
  access_token: process.env.ACCESS_TOKEN,
  access_token_secret: process.env.ACCESS_TOKEN_SECRET,
})

async function detectSentiment(text, language, id) {
  let sentiment = {}
  try {
    sentiment = await comprehend
      .detectSentiment({
        Text: text,
        LanguageCode: language,
      })
      .promise()
  } catch (err) {
    console.error(err)
    console.error(text)
  }
  return { ...sentiment, id }
}

async function getTweets(q, sinceId) {
  const res = await T.get('search/tweets', {
    q,
    count: args.t || 100,
    locale: 'en_US',
    since_id: sinceId,
  })

  const {
    data: { statuses },
  } = res

  return statuses.map(d => ({ text: d.text, id: d.id }))
}

(async () => {
  const sentiments = []
  const sinceId = db
    .get(args.s)
    .get('sinceId')
    .value()
  const tweets = await getTweets(args.s, sinceId)
  db.get(args.s)
    .update('sinceId', () => tweets[0].id)
    .write()
  for (let i = 0; i < tweets.length; i += 1) {
    sentiments.push(detectSentiment(tweets[i].text, 'en', tweets[i].id))
  }
  const res = await Promise.all(sentiments)
  let reduced = res
    .map(sentiment => sentiment.SentimentScore)
    .reduce((acc, c) => ({
      Positive: acc.Positive + c.Positive,
      Negative: acc.Negative + c.Negative,
      Neutral: acc.Neutral + c.Neutral,
    }))
  reduced = {
    positive: reduced ? reduced.Positive : 0,
    negative: reduced ? reduced.Negative : 0,
    neutral: reduced ? reduced.Neutral : 0,
  }
  const previousCount = db
    .get(args.s)
    .get(date)
    .get('count')
    .value()
  db.get(args.s)
    .get(date)
    .update(
      'positive',
      positive => (positive * previousCount + reduced.positive)
        / (res.length + previousCount),
    )
    .update(
      'negative',
      negative => (negative * previousCount + reduced.negative)
        / (res.length + previousCount),
    )
    .update(
      'neutral',
      neutral => (neutral * previousCount + reduced.neutral)
        / (res.length + previousCount),
    )
    .update('count', count => count + res.length)
    .write()
})()
