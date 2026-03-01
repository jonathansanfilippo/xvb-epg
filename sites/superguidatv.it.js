const cheerio = require('cheerio')
const axios = require('axios')
const { DateTime } = require('luxon')

module.exports = {
  site: 'superguidatv.it',
  days: 3,
  url({ channel, date }) {
    let diff = Math.floor(date.diff(DateTime.now().toUTC().startOf('day'), 'd').days)
    let day = {
      0: 'oggi',
      1: 'domani',
      2: 'dopodomani'
    }

    // fallback se diff non è 0/1/2
    const key = day[diff] || 'oggi'
    return `https://www.superguidatv.it/programmazione-canale/${key}/guida-programmi-tv-${channel.site_id}/`
  },
  parser({ content, date }) {
    const programs = []
    const items = parseItems(content)

    items.forEach(item => {
      const $item = cheerio.load(item)
      const prev = programs[programs.length - 1]
      let start = parseStart($item, date)

      if (prev) {
        if (start < prev.start) {
          start = start.plus({ days: 1 })
          date = date.plus({ days: 1 })
        }
        prev.stop = start
      }

      const stop = start.plus({ minutes: 30 })

      programs.push({
        title: parseTitle($item),
        category: parseCategory($item),
        start,
        stop
      })
    })

    return programs
  },
  async channels() {
    const providers = [
      '',
      'premium/',
      'sky-intrattenimento/',
      'sky-sport/',
      'sky-cinema/',
      'sky-doc-e-lifestyle/',
      'sky-news/',
      'sky-bambini/',
      'sky-musica/',
      'sky-primafila/',
      'dazn/',
      'rsi/'
    ]

    const promises = providers.map(p => axios.get(`https://www.superguidatv.it/canali/${p}`))

    const channels = []
    const responses = await Promise.allSettled(promises)

    responses.forEach(r => {
      if (r.status !== 'fulfilled') return
      const $ = cheerio.load(r.value.data)

      $('.sgtvchannellist_mainContainer .sgtvchannel_divCell a').each((i, link) => {
        let match = $(link).attr('href')?.match(/guida-programmi-tv-(.*)\/$/)
        let site_id = match ? match[1] : null
        let name = $(link).find('.pchannel').text().trim()

        if (site_id && name) {
          channels.push({
            lang: 'it',
            site_id,
            name
          })
        }
      })
    })

    return channels
  }
}

function parseStart($item, date) {
  const hours = $item('.sgtvchannelplan_hoursCell')
    .clone()
    .children('.sgtvOnairSpan')
    .remove()
    .end()
    .text()
    .trim()

  return DateTime.fromFormat(`${date.toFormat('yyyy-LL-dd')} ${hours}`, 'yyyy-LL-dd HH:mm', {
    zone: 'Europe/Rome'
  }).toUTC()
}

function parseTitle($item) {
  return $item('.sgtvchannelplan_spanInfoNextSteps').text().trim()
}

function parseCategory($item) {
  const eventType = $item('.sgtvchannelplan_spanEventType').text().trim()
  const [, category] = eventType.match(/(^[^(]+)/) || [null, '']
  return category.trim()
}

function parseItems(content) {
  const $ = cheerio.load(content)
  return $('.sgtvchannelplan_divContainer > .sgtvchannelplan_divTableRow')
    .has('#containerInfoEvent')
    .toArray()
}
