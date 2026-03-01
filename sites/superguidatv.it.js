const cheerio = require('cheerio')
const axios = require('axios')
const { DateTime } = require('luxon')

module.exports = {
  site: 'superguidatv.it',
  days: 3,

  url({ channel, date }) {
    const today = DateTime.now().setZone('Europe/Rome').startOf('day')
    const diff = Math.floor(date.diff(today, 'days').days)

    const dayMap = {
      0: 'oggi',
      1: 'domani',
      2: 'dopodomani'
    }

    if (!(diff in dayMap)) return null

    return `https://www.superguidatv.it/programmazione-canale/${dayMap[diff]}/guida-programmi-tv-${channel.site_id}/`
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

    const responses = await Promise.all(
      providers.map(p =>
        axios.get(`https://www.superguidatv.it/canali/${p}`)
      )
    )

    const channels = []

    responses.forEach(r => {
      const $ = cheerio.load(r.data)

      $('.sgtvchannellist_mainContainer .sgtvchannel_divCell a').each((_, el) => {
        const href = $(el).attr('href') || ''
        const match = href.match(/guida-programmi-tv-(.*)\/$/)
        const site_id = match?.[1]
        const name = $(el).find('.pchannel').text().trim()

        if (site_id && name) {
          channels.push({
            lang: 'it',
            site_id,
            name
          })
        }
      })
    })

    // dedupe per site_id
    const unique = []
    const seen = new Set()

    for (const ch of channels) {
      if (seen.has(ch.site_id)) continue
      seen.add(ch.site_id)
      unique.push(ch)
    }

    return unique
  },

  parser({ content, date }) {
    const programs = []
    const $ = cheerio.load(content)

    const rows = $('.sgtvchannelplan_divContainer > .sgtvchannelplan_divTableRow')
      .has('#containerInfoEvent')
      .toArray()

    rows.forEach(row => {
      const $row = cheerio.load(row)

      const hours = $row('.sgtvchannelplan_hoursCell')
        .clone()
        .children('.sgtvOnairSpan')
        .remove()
        .end()
        .text()
        .trim()

      if (!hours) return

      const day = date.setZone('Europe/Rome').toFormat('yyyy-MM-dd')

      const start = DateTime.fromFormat(
        `${day} ${hours}`,
        'yyyy-MM-dd HH:mm',
        { zone: 'Europe/Rome' }
      ).toUTC()

      const title = $row('.sgtvchannelplan_spanInfoNextSteps')
        .text()
        .trim()

      const categoryRaw = $row('.sgtvchannelplan_spanEventType')
        .text()
        .trim()

      const categoryMatch = categoryRaw.match(/(^[^(]+)/)
      const category = categoryMatch ? categoryMatch[1].trim() : ''

      programs.push({
        start,
        stop: start.plus({ minutes: 30 }), // fallback
        title,
        category
      })
    })

    // sistema gli stop usando il programma successivo
    for (let i = 0; i < programs.length - 1; i++) {
      programs[i].stop = programs[i + 1].start
    }

    return programs
  }
}
