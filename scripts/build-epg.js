const fs = require('fs')
const path = require('path')
const axios = require('axios')
const { DateTime } = require('luxon')

const site = require('../sites/superguidatv.it.js')

function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function toXmltvDate(dt) {
  // dt è luxon DateTime in UTC
  return dt.toFormat('yyyyLLddHHmmss') + ' +0000'
}

/**
 * Parsing semplice del tuo XML <channels>...</channels>
 * Estrae: site, site_id, lang, xmltv_id, name
 */
function loadChannelsFromXml(filePath) {
  const xml = fs.readFileSync(filePath, 'utf8')

  const channels = []
  const re = /<channel\s+([^>]+)>([\s\S]*?)<\/channel>/g
  let m

  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1]
    const name = m[2].trim()

    const getAttr = (key) => {
      const r = new RegExp(`${key}="([^"]*)"`)
      const mm = attrs.match(r)
      return mm ? mm[1] : ''
    }

    const siteName = getAttr('site')
    const site_id = getAttr('site_id')
    const lang = getAttr('lang') || 'it'
    const xmltv_id = getAttr('xmltv_id') || ''

    if (!site_id) continue

    channels.push({
      site: siteName,
      site_id,
      lang,
      xmltv_id,
      name
    })
  }

  return channels
}

async function fetchProgramsForChannel(ch, date) {
  const url = site.url({ channel: ch, date })
  const res = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (xvb-epg)' },
    timeout: 30000
  })
  return site.parser({ content: res.data, date })
}

async function main() {
  const days = site.days ?? 3

  // ✅ usa SOLO i canali del file statico
  const channelsFile = path.join(__dirname, '..', 'channels', 'superguidatv.channels.xml')
  const channels = loadChannelsFromXml(channelsFile)

  // dedupe: qui NON filtriamo i doppioni “logici” (come mi hai chiesto).
  // Però evitiamo id vuoti: se xmltv_id è vuoto, creiamo un id stabile.
  for (const ch of channels) {
    if (!ch.xmltv_id || !ch.xmltv_id.trim()) {
      ch.xmltv_id = `superguidatv.${ch.site_id}`
    }
  }

  let out = ''
  out += `<?xml version="1.0" encoding="UTF-8"?>\n`
  out += `<tv generator-info-name="xvb-epg">\n`

  // <channel>
  for (const ch of channels) {
    out += `  <channel id="${esc(ch.xmltv_id)}">\n`
    out += `    <display-name lang="${esc(ch.lang || 'it')}">${esc(ch.name || ch.site_id)}</display-name>\n`
    out += `  </channel>\n`
  }

  const base = DateTime.now().setZone('Europe/Rome').startOf('day')

  for (let d = 0; d < days; d++) {
    const dayDate = base.plus({ days: d })

    for (const ch of channels) {
      let programs = []
      try {
        programs = await fetchProgramsForChannel(ch, dayDate)
      } catch (e) {
        // non blocchiamo tutto se un canale fallisce
        continue
      }

      for (const p of programs) {
        const start = toXmltvDate(p.start)
        const stop = toXmltvDate(p.stop)

        out += `  <programme start="${esc(start)}" stop="${esc(stop)}" channel="${esc(ch.xmltv_id)}">\n`
        out += `    <title lang="it">${esc(p.title || '')}</title>\n`
        if (p.category && String(p.category).trim()) {
          out += `    <category lang="it">${esc(p.category)}</category>\n`
        }
        out += `  </programme>\n`
      }
    }
  }

  out += `</tv>\n`
  process.stdout.write(out)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})const axios = require('axios')
const { DateTime } = require('luxon')

const site = require('../sites/superguidatv.it.js')

// XML escape base
function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function toXmltvDate(dt) {
  // dt è luxon DateTime in UTC
  return dt.toFormat("yyyyLLddHHmmss") + " +0000"
}

async function fetchProgramsForChannel(ch, date) {
  const url = site.url({ channel: ch, date })
  const res = await axios.get(url, {
    headers: {
      // header semplice per evitare blocchi stupidi
      'User-Agent': 'Mozilla/5.0 (epg-bot)'
    },
    timeout: 30000
  })
  const programs = site.parser({ content: res.data, date })
  return programs
}

async function main() {
  const days = site.days ?? 3

  // 1) canali
  const channels = await site.channels()

  // dedupe minimo sui site_id (per sicurezza)
  const bySiteId = new Map()
  for (const ch of channels) {
    if (!ch.site_id) continue
    if (!bySiteId.has(ch.site_id)) bySiteId.set(ch.site_id, ch)
  }
  const uniqueChannels = [...bySiteId.values()]

  // 2) header XMLTV
  let out = ''
  out += `<?xml version="1.0" encoding="UTF-8"?>\n`
  out += `<tv generator-info-name="xvb-epg" generator-info-url="https://github.com/">\n`

  // 3) <channel> entries
  for (const ch of uniqueChannels) {
    const displayName = ch.name || ch.site_id
    // xmltv_id: se non c'è, usiamo un id "stabile" basato su site_id
    const xmltvId = ch.xmltv_id && ch.xmltv_id.trim().length ? ch.xmltv_id.trim() : `superguidatv.${ch.site_id}`
    out += `  <channel id="${esc(xmltvId)}">\n`
    out += `    <display-name lang="${esc(ch.lang || 'it')}">${esc(displayName)}</display-name>\n`
    out += `  </channel>\n`
  }

  // 4) programmi (per ogni canale, per ogni giorno)
  // date base: oggi in Europe/Rome (come nel parser)
  const base = DateTime.now().setZone('Europe/Rome').startOf('day')

  for (let d = 0; d < days; d++) {
    const dayDate = base.plus({ days: d })

    // fetch in serie (più stabile). Se vuoi parallelo dopo lo ottimizziamo.
    for (const ch of uniqueChannels) {
      const xmltvId = ch.xmltv_id && ch.xmltv_id.trim().length ? ch.xmltv_id.trim() : `superguidatv.${ch.site_id}`

      let programs = []
      try {
        programs = await fetchProgramsForChannel(ch, dayDate)
      } catch (e) {
        // non blocchiamo tutto se un canale fallisce
        continue
      }

      for (const p of programs) {
        // p.start/p.stop già UTC dal tuo parser
        const start = toXmltvDate(p.start)
        const stop = toXmltvDate(p.stop)

        out += `  <programme start="${esc(start)}" stop="${esc(stop)}" channel="${esc(xmltvId)}">\n`
        out += `    <title lang="it">${esc(p.title || '')}</title>\n`
        if (p.category && String(p.category).trim().length) {
          out += `    <category lang="it">${esc(p.category)}</category>\n`
        }
        out += `  </programme>\n`
      }
    }
  }

  out += `</tv>\n`

  process.stdout.write(out)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
