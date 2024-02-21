const express = require('express')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const app = express()
app.use(express.json())
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const path = require('path')
const dbPath = path.join(__dirname, 'twitterClone.db')

let db = null

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server is Running at http://localhost:3000')
    })
  } catch (e) {
    console.log(`DB Error: ${e.message}`)
    process.exit(1)
  }
}

initializeDBAndServer()

const autenticateToken = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'MY_SECRET_TOKEN', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload
        next()
      }
    })
  }
}

//POST API-1

app.post('/register/', async (request, response) => {
  const {username, password, gender, name} = request.body
  const dbUser = await db.get(
    `SELECT * FROM user WHERE username = "${username}";`,
  )
  if (dbUser === undefined) {
    if (password.length > 6) {
      const hashedPassword = await bcrypt.hash(password, 10)
      await db.run(`
            INSERT INTO 
            user(username, password, gender, name)
            VALUES
            ("${username}", "${hashedPassword}", "${gender}", "${name}");`)
      response.status(200)
      response.send('User created successfully')
    } else {
      response.status(400)
      response.send('Password is too short')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

//POST API-2

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const userQuery = `SELECT * FROM user WHERE username = "${username}";`
  const dbUser = await db.get(userQuery)
  if (dbUser !== undefined) {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const jwtToken = jwt.sign(username, 'MY_SECRET_TOKEN')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  } else {
    response.status(400)
    response.send('Invalid user')
  }
})

const tweetResponse = dbObject => ({
  username: dbObject.username,
  tweet: dbObject.tweet,
  dateTime: dbObject.date_time,
})

//GET API-3

app.get('/user/tweets/feed/', autenticateToken, async (request, response) => {
  const tweetQuery = `
    SELECT 
      tweet.tweet_id, 
      tweet.user_id, 
      user.username, 
      tweet.tweet, 
      tweet.date_time 
    FROM 
      follower
    LEFT JOIN tweet ON tweet.user_id=follower.following_user_id
    LEFT JOIN user ON follower.following_user_id=user.user_id 
    WHERE follower.follower_user_id = (SELECT user_id FROM user WHERE username = "${request.username}")
    ORDER BY tweet.date_time DESC
    LIMIT 4;`

  const latestTweets = await db.all(tweetQuery)
  response.send(latestTweets.map(item => tweetResponse(item)))
})

//GET API-4

app.get('/user/following/', autenticateToken, async (request, response) => {
  const followingQuery = `
    SELECT 
      user.name
    FROM 
      follower
    LEFT JOIN user ON follower.following_user_id = user.user_id 
    WHERE follower.follower_user_id = (SELECT user_id FROM user WHERE username = "${request.username}");
    `
  const followingArray = await db.all(followingQuery)
  response.send(followingArray)
})

//GET API-5

app.get('/user/followers/', autenticateToken, async (request, response) => {
  const followerQuery = `
    SELECT
      user.name
    FROM 
      follower
    LEFT JOIN user ON follower.follower_user_id=user.user_id 
    WHERE follower.following_user_id=(SELECT user_id FROM user WHERE username="${request.username}");`
  const followerArray = await db.all(followerQuery)
  response.send(followerArray)
})

const follows = async (request, response, next) => {
  const {tweetId} = request.params
  let isFollowing = await db.get(
    `SELECT * FROM follower WHERE follower_user_id=(SELECT user.user_id FROM tweet NATURAL JOIN user WHERE tweet_id=${tweetId});`,
  )
  if (isFollowing === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}

//GET API-6

app.get(
  '/tweets/:tweetId/',
  autenticateToken,
  follows,
  async (request, response) => {
    const {tweetId} = request.params
    const {tweet, date_time} = await db.get(
      `SELECT tweet.tweet, tweet.date_time FROM tweet WHERE tweet_id = ${tweetId};`,
    )
    const {likes} = await db.get(
      `SELECT COUNT(like_id) AS likes FROM like WHERE tweet_id = ${tweetId};`,
    )
    const {replies} = await db.get(
      `SELECT COUNT(reply_id) AS replies FROM reply WHERE tweet_id = ${tweetId};`,
    )
    response.send({tweet, likes, replies, dateTime: date_time})
  },
)

//GET API-7

app.get(
  '/tweets/:tweetId/likes/',
  autenticateToken,
  follows,
  async (request, response) => {
    const {tweetId} = request.params
    const likedBy = await db.all(
      `SELECT user.username FROM like NATURAL JOIN user WHERE tweet_id=${tweetId};`,
    )
    response.send({likes: likedBy.map(item => item.username)})
  },
)

//GET API-8

app.get(
  '/tweets/:tweetId/replies/',
  autenticateToken,
  follows,
  async (request, response) => {
    const {tweetId} = request.params
    const replies = await db.all(
      `SELECT user.name, reply.reply FROM reply NATURAL JOIN user WHERE tweet_id=${tweetId};`,
    )
    response.send({replies})
  },
)

//GET API-9

app.get('/user/tweets/', autenticateToken, async (request, response) => {
  const myTweets = await db.all(`
  SELECT 
    tweet.tweet, 
    COUNT(distinct like.like_id) AS likes, 
    COUNT(distinct reply.reply_id) AS replies,
    tweet.date_time 
  FROM
    tweet 
  LEFT JOIN like ON tweet.tweet_id = like.tweet_id 
  LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id 
  WHERE tweet.user_id = (SELECT user_id FROM user WHERE username = "${request.username}")
  GROUP BY tweet.tweet_id;`)
  response.send(
    myTweets.map(item => {
      const {date_time, ...rest} = item
      return {...rest, dateTime: date_time}
    }),
  )
})

//GET API-10

app.post('/user/tweets/', autenticateToken, async (request, response) => {
  const {tweet} = request.body
  const {user_id} = await db.get(
    `SELECT user_id FROM user WHERE username = "${request.username}";`,
  )
  await db.run(
    `INSERT INTO tweet(tweet, user_id) VALUES("${tweet}", ${user_id});`,
  )
  response.send('Created a Tweet')
})

//DELETE AI-11

app.delete('/tweets/:tweetId/', autenticateToken, async (request, response) => {
  const {tweetId} = request.params
  const usetTweets = await db.get(`SELECT tweet_id, user_id
  FROM tweet WHERE tweet_id=${tweetId} AND user_id=(SELECT user_id FROM user WHERE username = "${request.username}");`)
  if (usetTweets === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    await db.run(`DELETE FROM tweet WHERE tweet_id=${tweetId};`)
    response.send('Tweet Removed')
    return
  }
})

module.exports = app
