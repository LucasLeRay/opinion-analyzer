#!/usr/bin/env node

const dotenv = require('dotenv')
const AWS = require('aws-sdk')
const Twit = require('twit')
const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')

const adapter = new FileSync('db.json')
const db = low(adapter)
db.defaults({ sentiments: [], sinceId: 0 }).write()

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
  const sentiment = await comprehend
    .detectSentiment({
      Text: text,
      LanguageCode: language,
    })
    .promise()
  return { ...sentiment, id }
}

async function getTweets(q, sinceId) {
  const res = await T.get('search/tweets', {
    q,
    count: 100,
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
  const sinceId = db.get('sinceId').value()
  const tweets = await getTweets('Donald Trump', sinceId)
  db.update('sinceId', () => tweets[0].id).write()
  for (let i = 0; i < tweets.length; i += 1) {
    sentiments.push(detectSentiment(tweets[i].text, 'en', tweets[i].id))
  }
  const res = await Promise.all(sentiments)
  db.get('sentiments')
    .push(
      ...res.map(r => ({
        id: r.id,
        positive: r.SentimentScore.Positive,
        negative: r.SentimentScore.Negative,
        neutral: r.SentimentScore.Neutral,
      })),
    )
    .write()
})()
