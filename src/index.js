process.env.NTBA_FIX_319 = 1;

const TelegramBot = require('node-telegram-bot-api')
const mongoose = require('mongoose')
const geolib = require('geolib')
const _ = require('lodash')
const config = require('./config')
const helper = require('./helper')
const kb = require('./keyboard_buttons')
const keyboard = require('./keyboard')
const database = require('../database.json')

helper.logStart()

mongoose.connect(config.DB_URL, {useUnifiedTopology: true, useNewUrlParser: true})
  .then(() => {
    console.log('MongoDB connected...')
  })
  .catch((err) => console.error(err))

require('./model/film.model')
require('./model/cinema.model')
require('./model/user.model')
const Film = mongoose.model('films')
const Cinema = mongoose.model('cinemas')
const User = mongoose.model('users')

// database.films.forEach(f => new Film(f).save())
// database.cinemas.forEach(c => new Cinema(c).save())

const ACTION_TYPE = {
  TOGGLE_FAV_FILM: 'tff',
  SHOW_CINEMAS: 'sc',
  SHOW_CINEMAS_MAP: 'scm',
  SHOW_FILMS: 'sf'
}

// =======================================
const bot = new TelegramBot(config.TOKEN, {polling: true})

bot.on('message', msg => {
  const chatId = helper.getChatId(msg)

  switch (msg.text) {
    case kb.home.favorite:
      showFavoriteFilms(chatId, msg.from.id)
      break
    case kb.home.films:
      bot.sendMessage(chatId, `Выберите жанр:`, {
        reply_markup: {
          keyboard: keyboard.film
        }
      })
      break
    case kb.film.comedy:
      sendFilmsByQuery(chatId, {type: 'comedy'})
      break
    case kb.film.action:
      sendFilmsByQuery(chatId, {type: 'action'})
      break
    case kb.film.random:
      sendFilmsByQuery(chatId, {})
      break
    case kb.home.cinemas:
      bot.sendMessage(chatId, `Отправить местоположение`, {
        reply_markup: {
          keyboard: keyboard.cinemas
        }
      })
      break
    case kb.back:
      bot.sendMessage(chatId, `Что хотите посмотреть?:`, {
        reply_markup: {
          keyboard: keyboard.home
        }
      })
      break
  }

  if (msg.location) {
    getCinemasInCoords(chatId, msg.location)
  }
})

bot.on('callback_query', query => {
  const userId = query.from.id
  let data

  try {
    data = JSON.parse(query.data)
  } catch (e) {
    throw new Error('Data is not an object')
  }

  const {type} = data

  if (type === ACTION_TYPE.SHOW_CINEMAS_MAP) {
    const {lat, lon} = data
    bot.sendLocation(query.message.chat.id, lat, lon)

  } else if (type === ACTION_TYPE.SHOW_CINEMAS) {
    sendCinemasByQuery(userId, {uuid: {'$in': data.cinemaUuids}})

  } else if (type === ACTION_TYPE.TOGGLE_FAV_FILM) {
    toggleFavouriteFilm(userId, query.id, data)

  } else if (type === ACTION_TYPE.SHOW_FILMS) {
    sendFilmsByQuery(userId, {uuid: {'$in': data.filmUuids}})
  }
})

bot.on('inline_query', query => {
  Film.find({}).then(films => {
    const results = films.map(f => {
      const caption = `Название: ${f.name}\nГод: ${f.year}\nРейтинг: ${f.rate}\nДлительность: ${f.length}\nСтрана: ${f.country}`

      return {
        id: f.uuid,
        type: 'photo',
        photo_url: f.picture,
        thumb_url: f.picture,
        caption: caption,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: `Кинопоиск: ${f.name}`,
                url: f.link
              }
            ]
          ]
        }
      }
    })

    bot.answerInlineQuery(query.id, results, {
      cache_time: 0
    })
  })
})

bot.onText(/\/start/, msg => {
  const text = `Здравствуйте, ${msg.from.first_name} \nВыберите команду для начала работы:`
  bot.sendMessage(helper.getChatId(msg), text, {
    reply_markup: {
      keyboard: keyboard.home
    }
  })
})

bot.onText(/\/f(.+)/, (msg, [source, match]) => {
  const filmUuid = helper.getItemUuid(source)
  const chatId = helper.getChatId(msg)

  Promise.all([
    Film.findOne({uuid: filmUuid}),
    User.findOne({telegramId: msg.from.id})
  ]).then(([film, user]) => {

    let isFav = false

    if (user) {
      isFav = user.films.indexOf(film.uuid) !== -1
    }

    const favText = isFav ? 'Удалить из избранного' : 'Добавить в избранное'

    const caption = `Название: ${film.name}\nГод: ${film.year}\nРейтинг: ${film.rate}\nДлительность: ${film.length}\nСтрана: ${film.country}`

    bot.sendPhoto(chatId, film.picture, {
      caption: caption,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: favText,
              callback_data: JSON.stringify({
                type: ACTION_TYPE.TOGGLE_FAV_FILM,
                filmUuid: film.uuid,
                isFav: isFav
              })
            },
            {
              text: 'В кинотеатрах',
              callback_data: JSON.stringify({
                type: ACTION_TYPE.SHOW_CINEMAS,
                cinemaUuids: film.cinemas
              })
            }
          ],
          [
            {
              text: `Кинопоиск ${film.name}`,
              url: film.link
            }
          ]
        ]
      }
    })
  })
})

bot.onText(/\/c(.+)/, (msg, [source, match]) => {
  const cinemaUid = helper.getItemUuid(source)
  const chatId = helper.getChatId(msg)

  Cinema.findOne({uuid: cinemaUid}).then(cinema => {
    bot.sendMessage(chatId, `Кинотеатр ${cinema.name}`, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: cinema.name,
              url: cinema.url
            },
            {
              text: 'Показать на карте',
              callback_data: JSON.stringify({
                type: ACTION_TYPE.SHOW_CINEMAS_MAP,
                lat: cinema.location.latitude,
                lon: cinema.location.longitude
              })
            }
          ],
          [
            {
              text: 'Показать фильмы',
              callback_data: JSON.stringify({
                type: ACTION_TYPE.SHOW_FILMS,
                filmUuids: cinema.films
              })
            }
          ]
        ]
      }
    })
  })
})

// ===================================

function sendFilmsByQuery(chatId, query) {
  Film.find(query).then(films => {
    const html = films.map((f, i) => {
      return `<b>${i + 1}</b> ${f.name} - /f${f.uuid}`
    }).join('\n')

    sendHTML(chatId, html, 'film')

  })
}

function sendHTML(chatId, html, keyboardName = null) {
  const options = {
    parse_mode: 'HTML'
  }

  if (keyboardName) {
    options['reply_markup'] = {
      keyboard: keyboard[keyboardName]
    }
  }

  bot.sendMessage(chatId, html, options)
}

function getCinemasInCoords(chatId, location) {
  Cinema.find({}).then(cinemas => {

    cinemas.forEach(c => {
      c.distance = geolib.getDistance(location, c.location) / 1000
    })

    cinemas = _.sortBy(cinemas, 'distance')

    const html = cinemas.map((c, i) => {
      return `<b>${i + 1}</b> ${c.name}. <em>Расстояние: </em> - <strong>${c.distance}</strong> км. /c${c.uuid}`
    }).join('\n')

    sendHTML(chatId, html, 'home')
  })
}

function toggleFavouriteFilm(userId, queryId, {filmUuid, isFav}) {

  let userPromise

  User.findOne({telegramId: userId})
    .then(user => {
      if (user) {
        if (isFav) {
          user.films = user.films.filter(fUuid => fUuid !== filmUuid)
        } else {
          user.films.push(filmUuid)
        }
        userPromise = user
      } else {
        userPromise = new User({
          telegramId: userId,
          films: [filmUuid]
        })
      }

      const answerText = isFav ? 'Удалено' : 'Добавлено'

      userPromise.save().then(_ => {
        bot.answerCallbackQuery(queryId, {text: answerText, show_alert: true})
      }).catch(err => console.log(err))
    }).catch(err => console.log(err))
}

function showFavoriteFilms(chatId, telegramId) {
  User.findOne({telegramId}).then(user => {
    if (user) {
      Film.find({uuid: {'$in': user.films}}).then(films => {
        let html

        if (films.length) {
          html = films.map((f, i) => {
            return `<b>${i + 1}</b> ${f.name} - <b>${f.rate}</b> (/f${f.uuid})`
          }).join('\n')
        } else {
          html = 'Вы пока ничего не добавили'
        }
        sendHTML(chatId, html, 'home')

      }).catch(e => console.log(e))
    } else {
      sendHTML(chatId, 'Вы пока ничего не добавили', 'home')
    }
  }).catch(e => console.log(e))
}

function sendCinemasByQuery(userId, query) {
  Cinema.find(query).then(cinemas => {
    const html = cinemas.map((c, i) => {
      return `<b>${i + 1}</b> ${c.name} - /c${c.uuid}`
    }).join('\n')

    sendHTML(userId, html, 'home')
  })
}
