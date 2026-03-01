const cheerio = require('cheerio')
const axios = require('axios')
const { DateTime } = require('luxon')

module.exports = {
  site: 'superguidatv.it',
  days: 3,

  url({ channel, date }) {
    const diff = Math.round(
      date.startOf('day').diff(DateTime.now().toUTC().startOf('day'), 'days').days
    )

    const day = { 0: 'oggi', 1: 'domani', 2: 'dopodomani' }
    const key = day[diff] ?? 'oggi'
    return `https://www.superguidatv.it/programmazione-canale/${key}/guida-programmi-tv-${channel.site_id}/`
  },

  parser({ content, date }) {
    const $ = cheerio.load(content)
    const programs = []

    const rows = $('.sgtvchannelplan_divContainer > .sgtvchannelplan_divTableRow')
      .has('#containerInfoEvent')
      .toArray()

    rows.forEach((row) => {
      const $row = cheerio.load($.html(row))
      const hours = $row('.sgtvchannelplan_hoursCell')
        .clone()
        .children('.sgtvOnairSpan')
        .remove()
        .end()
        .text()
        .trim()

      if (!hours) return

      let start = DateTime.fromFormat(
        `${date.toFormat('yyyy-MM-dd')} ${hours}`,
        'yyyy-MM-dd HH:mm',
        { zone: 'Europe/Rome' }
      ).toUTC()

      // se l'orario “torna indietro” rispetto al precedente, siamo oltre la mezzanotte
      const prev = programs[programs.length - 1]
      if (prev && start < prev.start) {
        start = start.plus({ days: 1 })
      }

      const title = $row('.sgtvchannelplan_spanInfoNextSteps').text().trim()

      const eventType = $row('.sgtvchannelplan_spanEventType').text().trim()
      const [, category] = eventType.match(/(^[^(]+)/) || [null, '']
      const cat = (category || '').trim()

      programs.push({
        title: title || 'N/A',
        category: cat,
        start,
        stop: start.plus({ minutes: 30 }) // stop “provvisorio”, poi lo aggiustiamo sotto
      })
    })

    // aggiusta stop = start successivo
    for (let i = 0; i < programs.length - 1; i++) {
      programs[i].stop = programs[i + 1].start
    }

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

    const channels = []
    const responses = await Promise.all(
      providers.map((p) => axios.get(`https://www.superguidatv.it/canali/${p}`))
    )

    responses.forEach((r) => {
      const $ = cheerio.load(r.data)

      $('.sgtvchannellist_mainContainer .sgtvchannel_divCell a').each((i, link) => {
        const href = $(link).attr('href') || ''
        const match = href.match(/guida-programmi-tv-(.*)\/$/)
        const site_id = match ? match[1] : null
        const name = $(link).find('.pchannel').text().trim()

        if (site_id && name) {
          channels.push({ lang: 'it', site_id, name })
        }
      })
    })

    return channels
  }
}
