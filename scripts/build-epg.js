const fs = require('fs')
const path = require('path')
const axios = require('axios')
const { DateTime } = require('luxon')
const { XMLParser } = require('fast-xml-parser')

// site parser
const site = require('../sites/superguidatv.it')

// ---- config ----
const CHANNELS_XML_PATH = path.join(__dirname, '..', 'channels', 'superguidatv.channels.xml')
const GENERATOR_NAME = 'xvb-epg-it'

// ---- utils ----
function xmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function toXmltvDate(dtUtc) {
  // XMLTV: YYYYMMDDHHMMSS +0000
  return dtUtc.toUTC().toFormat("yyyyLLddHHmmss ' +0000'")
}

function safeChannelId(ch) {
  // prefer xmltv_id se esiste, altrimenti fallback stabile
  const xmltvId = String(ch.xmltv_id ?? '').trim()
  if (xmltvId) return xmltvId

  // fallback: site_id pulito
  const sid = String(ch.site_id ?? '').trim()
  if (sid) return `superguidatv:${sid}`

  // ultima spiaggia
  return `channel:${String(ch.name ?? 'unknown').trim().replace(/\s+/g, '_')}`
}

function readChannelsXml(filePath) {
  const xml = fs.readFileSync(filePath, 'utf8')

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    textNodeName: '#text',
    // IMPORTANTISSIMO: non convertire "20" in numero
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true
  })

  const obj = parser.parse(xml)

  // Supporta sia <channels><channel ...>name</channel></channels>
  // sia eventuali varianti
  const channelsRaw = obj?.channels?.channel ?? []
  const arr = Array.isArray(channelsRaw) ? channelsRaw : [channelsRaw]

  return arr
    .map(c => {
      const name = String(c['#text'] ?? '').trim() // sempre stringa
      return {
        site: String(c.site ?? '').trim(),
        site_id: String(c.site_id ?? '').trim(),
        lang: String(c.lang ?? 'it').trim(),
        xmltv_id: String(c.xmltv_id ?? '').trim(),
        name
      }
    })
    .filter(c => c.site_id && c.name)
}

async function fetchProgramsForChannel(ch, days) {
  const programs = []
  let date = DateTime.now().toUTC().startOf('day')

  for (let d = 0; d < days; d++) {
    const url = site.url({ channel: ch, date })
    if (!url) {
      date = date.plus({ days: 1 })
      continue
    }

    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (xvb-epg)'
      },
      timeout: 30000
    })

    const parsed = site.parser({ content: res.data, date })
    programs.push(...parsed)

    date = date.plus({ days: 1 })
  }

  // ordina e “normalizza” stop (nel caso l’ultimo abbia stop fallback)
  programs.sort((a, b) => a.start.toMillis() - b.start.toMillis())
  for (let i = 0; i < programs.length - 1; i++) {
    programs[i].stop = programs[i + 1].start
  }
  return programs
}

async function main() {
  const channels = readChannelsXml(CHANNELS_XML_PATH)

  // header XMLTV
  let out = ''
  out += `<?xml version="1.0" encoding="UTF-8"?>\n`
  out += `<tv generator-info-name="${xmlEscape(GENERATOR_NAME)}">\n`

  // channels section
  const idByChannel = new Map()
  for (const ch of channels) {
    const id = safeChannelId(ch)
    idByChannel.set(ch, id)

    out += `  <channel id="${xmlEscape(id)}">\n`
    out += `    <display-name lang="${xmlEscape(ch.lang || 'it')}">${xmlEscape(ch.name)}</display-name>\n`
    out += `  </channel>\n`
  }

  for (const ch of channels) {
    const channelId = idByChannel.get(ch)
    const programs = await fetchProgramsForChannel(ch, site.days || 3)

    for (const p of programs) {
      out += `  <programme start="${xmlEscape(toXmltvDate(p.start))}" stop="${xmlEscape(toXmltvDate(p.stop))}" channel="${xmlEscape(channelId)}">\n`
      out += `    <title lang="it">${xmlEscape(p.title || '')}</title>\n`
      if (p.category) out += `    <category lang="it">${xmlEscape(p.category)}</category>\n`
      out += `  </programme>\n`
    }
  }

  out += `</tv>\n`

  process.stdout.write(out)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
