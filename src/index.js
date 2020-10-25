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

// =======================================
const bot = new TelegramBot(config.TOKEN, {polling: true})

bot.on('message', msg => {
  const chatId = helper.getChatId(msg)

  switch (msg.text) {
    case kb.home.favorite:
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

  Film.findOne({uuid: filmUuid}).then(film => {
    const caption = `Название: ${film.name}\nГод: ${film.year}\nРейтинг: ${film.rate}\nДлительность: ${film.length}\nСтрана: ${film.country}`

    bot.sendPhoto(chatId, film.picture, {
      caption: caption,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'В избранное',
              callback_data: film.uuid
            },
            {
              text: 'В кинотеатрах',
              callback_data: film.uuid
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
              callback_data: cinema.uuid
            }
          ],
          [
            {
              text: 'Показать фильмы',
              callback_data: JSON.stringify(cinema.films)
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
