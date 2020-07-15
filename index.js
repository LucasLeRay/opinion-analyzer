const AWS = require("aws-sdk");
const Twit = require("twit");
const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");
require("dotenv").config();
const args = require("minimist")(process.argv.slice(2), {
  alias: {
    h: "help",
    s: "subject",
    t: "tweets",
  },
  default: {
    t: 100,
  },
});

if (!args.s) {
  console.error("No subject.");
  process.exit(1);
}

const comprehend = new AWS.Comprehend({
  apiVersion: "2017-11-27",
  region: "eu-west-1",
});

const T = new Twit({
  consumer_key: process.env.CONSUMER_KEY,
  consumer_secret: process.env.CONSUMER_SECRET,
  access_token: process.env.ACCESS_TOKEN,
  access_token_secret: process.env.ACCESS_TOKEN_SECRET,
});

const dateObj = new Date();
const month = dateObj.getUTCMonth() + 1;
const day = dateObj.getUTCDate();
const year = dateObj.getUTCFullYear();
const date = `${month}-${day}-${year}`;

const adapter = new FileSync("db.json");
const db = low(adapter);
db.defaults({
  [args.s]: {
    [date]: {
      positive: 0,
      negative: 0,
      count: 0,
    },
    sinceId: 0,
  },
}).write();
const entry = db.get(args.s).get(date).value();
if (!entry) {
  db.set(`${args.s}.${date}`, {
    positive: 0,
    negative: 0,
    count: 0,
  }).write();
}

async function detectSentiment(text, language) {
  let res = {};
  try {
    res = await comprehend
      .detectSentiment({
        Text: text,
        LanguageCode: language,
      })
      .promise();
  } catch (err) {
    console.error(err, text);
  }
  return res.Sentiment;
}

async function getTweets(q, sinceId) {
  const res = await T.get("search/tweets", {
    q,
    count: args.t,
    locale: "en_US",
    since_id: sinceId,
  });

  const {
    data: { statuses },
  } = res;

  return statuses
    .map((d) => ({ text: d.text, id: d.id }));
}

(async () => {
  const sinceId = db.get(args.s).get("sinceId").value();
  const tweets = await getTweets(args.s, sinceId);
  if (tweets.length === 0) return;
  db.get(args.s)
    .update("sinceId", () => tweets[0].id)
    .write();
  const sentiments = await Promise.all(
    tweets.map((tweet) => detectSentiment(tweet.text, "en"))
  );
  let reduced = sentiments.reduce(
    (acc, sentiment) => ({
      positive: acc.positive + (sentiment === "POSITIVE" ? 1 : 0),
      negative: acc.negative + (sentiment === "NEGATIVE" ? 1 : 0),
    }),
    {
      positive: 0,
      negative: 0,
    }
  );
  const previousCount = db.get(args.s).get(date).get("count").value();
  db.get(args.s)
    .get(date)
    .update(
      "positive",
      (positive) =>
        (positive * previousCount + reduced.positive) /
        (sentiments.length + previousCount)
    )
    .update(
      "negative",
      (negative) =>
        (negative * previousCount + reduced.negative) /
        (sentiments.length + previousCount)
    )
    .update("count", (count) => count + sentiments.length)
    .write();
})();
