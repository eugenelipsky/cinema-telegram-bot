const mongoose = require('mongoose')
const Schema = mongoose.Schema

const FilmSchema = new Schema({
  name: {
    type: String,
    required: true
  },
  type: {
    type: String,
    required: true
  },
  uuid: {
    type: String,
    required: true
  },
  year: String,
  rate: Number,
  length: String,
  country: String,
  link: String,
  picture: String,
  cinemas: {
    type: [String],
    default: []
  }
})

mongoose.model('films', FilmSchema)
