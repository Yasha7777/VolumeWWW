import {
  Document, Page, View, Text, StyleSheet, Font, Svg, Path, Image, Link,
} from '@react-pdf/renderer'
import { STUB } from './raschetData'

/* ============================================================
   RaschetDocument — сам документ «Расчёт объёма и массы материала».
   ------------------------------------------------------------
   ТЯЖЁЛЫЙ модуль: тянет @react-pdf/renderer. Импортируется ТОЛЬКО
   через dynamic import (PdfDownload / PdfPreview) — не добавляй
   статических импортов этого файла в страницы!

   Кириллица: регистрируем Onest из /public/fonts/*.ttf — иначе
   стандартный Helvetica даст пустые квадраты.

   СТРУКТУРА ДОКУМЕНТА:
     шапка (организация + № расчёта) → 1. Объект замера →
     2. Результат расчёта (4 карточки, масса выделена золотом) →
     3. Фотофиксация → подпись, М.П., дата составления.
   Без водяных знаков и дисклеймеров — простой рабочий документ.
   ============================================================ */

/* ---------- Шрифт: 3 .ttf лежат в frontend/public/fonts/ ---------- */
const FONTS = import.meta.env.BASE_URL + 'fonts/'
Font.register({
  family: 'Onest',
  fonts: [
    { src: FONTS + 'Onest-Regular.ttf', fontWeight: 400 },
    { src: FONTS + 'Onest-SemiBold.ttf', fontWeight: 600 },
    { src: FONTS + 'Onest-Bold.ttf', fontWeight: 700 },
  ],
})
Font.registerHyphenationCallback((w) => [w])

const GREEN  = '#1E3D12'
const GOLD   = '#B87A18'
const INK    = '#111111'
const MUTED  = '#6B6657'
const HAIR   = '#9a9a9a'
const HAIR_W = 0.5
const ACCENT = '#FBF7EE'   /* кремовая подложка карточки массы */

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Onest', fontSize: 9.5, color: INK, lineHeight: 1.35,
    paddingTop: 44, paddingBottom: 64, paddingHorizontal: 42,
  },

  /* фирменная плашка сверху: зелёная полоса + золотая нить */
  topBar:  { position: 'absolute', top: 0, left: 0, right: 0, height: 7, backgroundColor: GREEN },
  goldBar: { position: 'absolute', top: 7, left: 0, right: 0, height: 1.5, backgroundColor: GOLD },

  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  orgBlock: { flexDirection: 'row', alignItems: 'flex-start' },
  orgText: { marginLeft: 12 },
  orgName: { fontSize: 17, fontWeight: 700, color: INK, letterSpacing: 0.2 },
  /* реквизиты с воздухом: было marginTop 3 — строки слипались */
  orgReq: { fontSize: 7.5, color: '#444', marginTop: 7, lineHeight: 1.4 },

  /* номер расчёта — карточкой справа (дата теперь только внизу документа) */
  docTag: {
    borderWidth: HAIR_W, borderColor: HAIR, borderRadius: 6,
    padding: '9 14', alignItems: 'center', justifyContent: 'center',
  },
  docTagLabel: { fontSize: 6.8, fontWeight: 600, color: MUTED, letterSpacing: 0.9, textTransform: 'uppercase', marginBottom: 4 },
  docTagNo:   { fontSize: 12, fontWeight: 700, color: GREEN },

  headerRule: { borderBottomWidth: 1.4, borderBottomColor: GREEN, marginTop: 12 },
  headerRule2: { borderBottomWidth: HAIR_W, borderBottomColor: GREEN, marginTop: 1.5 },

  titleWrap: { alignItems: 'center', marginTop: 16, marginBottom: 16 },
  title: { fontSize: 15, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' },

  secHd: { fontSize: 11, fontWeight: 700, marginTop: 6, marginBottom: 8, color: GREEN },
  box: { borderWidth: HAIR_W, borderColor: HAIR, borderRadius: 6, overflow: 'hidden' },
  oRow: { flexDirection: 'row', borderBottomWidth: HAIR_W, borderBottomColor: HAIR },
  oRowLast: { flexDirection: 'row' },
  oLabel: { width: 150, padding: '7 10', borderRightWidth: HAIR_W, borderRightColor: HAIR, color: '#333' },
  oValue: { flex: 1, padding: '7 10' },
  oLink: { color: GREEN, textDecoration: 'underline' },

  /* ── п.2: результат — 4 карточки с главными цифрами ── */
  sumRow: { flexDirection: 'row', justifyContent: 'space-between' },
  sumBox: {
    width: '23.7%',
    borderWidth: HAIR_W, borderColor: HAIR, borderRadius: 6,
    padding: '11 12',
  },
  sumBoxAccent: {
    borderLeftWidth: 3, borderLeftColor: GOLD,
    backgroundColor: ACCENT,
  },
  sumLabel: {
    fontSize: 6.8, fontWeight: 600, color: MUTED,
    letterSpacing: 0.9, textTransform: 'uppercase', marginBottom: 6,
  },
  sumVal:  { fontSize: 16, fontWeight: 700, color: INK },
  sumValM: { fontSize: 13, fontWeight: 700, color: INK, textTransform: 'capitalize' },
  sumUnit: { fontSize: 8.5, fontWeight: 400, color: MUTED },

  photos: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  photoCol: { width: '31.5%' },
  photoFrame: { height: 108, borderWidth: HAIR_W, borderColor: HAIR, borderRadius: 4, objectFit: 'cover' },
  photoStub: { height: 108, borderWidth: HAIR_W, borderColor: HAIR, borderRadius: 4, backgroundColor: '#e7e7e7' },
  photoCap: { textAlign: 'center', marginTop: 5, fontSize: 9, color: MUTED },

  signWrap: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 30 },
  signLine: { flexDirection: 'row', alignItems: 'flex-end' },
  signRule: { width: 150, borderBottomWidth: HAIR_W, borderBottomColor: INK, marginHorizontal: 6, height: 11 },
  /* дата составления — внизу документа, заполняется автоматически */
  dateLine: { marginTop: 14, color: '#333' },

  footer: {
    position: 'absolute', bottom: 26, left: 42, right: 42,
    borderTopWidth: HAIR_W, borderTopColor: HAIR, paddingTop: 5,
    flexDirection: 'row', justifyContent: 'space-between', fontSize: 7.5, color: '#666',
  },
})

const Logo = () => (
  <Svg width={34} height={34} viewBox="0 0 24 24">
    <Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke={GREEN} strokeWidth={1.8} fill="none" />
    <Path d="M9 22 V12 H15 V22" stroke={GREEN} strokeWidth={1.8} fill="none" />
  </Svg>
)

export function RaschetDocument({ data = {} }) {
  const d = { ...STUB, ...data }
  const r = d.rows[0] || {}
  return (
    <Document title={`Расчёт ${d.docNo}`} author={d.org}>
      <Page size="A4" style={styles.page}>
        {/* фирменная полоса сверху */}
        <View style={styles.topBar} fixed />
        <View style={styles.goldBar} fixed />

        {/* шапка: организация слева, номер расчёта справа (без даты) */}
        <View style={styles.header}>
          <View style={styles.orgBlock}>
            <Logo />
            <View style={styles.orgText}>
              <Text style={styles.orgName}>{d.org}</Text>
              <Text style={styles.orgReq}>ИНН {d.inn} · ОГРН {d.ogrn}</Text>
              <Text style={styles.orgReq}>{d.region} · {d.email}</Text>
            </View>
          </View>
          <View style={styles.docTag}>
            <Text style={styles.docTagLabel}>Расчёт</Text>
            <Text style={styles.docTagNo}>№ {d.docNo}</Text>
          </View>
        </View>
        <View style={styles.headerRule} />
        <View style={styles.headerRule2} />

        <View style={styles.titleWrap}>
          <Text style={styles.title}>Расчёт объёма и массы материала</Text>
        </View>

        <Text style={styles.secHd}>1. Объект замера</Text>
        <View style={styles.box}>
          <View style={styles.oRow}>
            <Text style={styles.oLabel}>Объект / замер:</Text>
            <Text style={styles.oValue}>{d.object}</Text>
          </View>
          <View style={styles.oRow}>
            <Text style={styles.oLabel}>Координаты:</Text>
            <Text style={styles.oValue}>{d.coords}</Text>
          </View>
          <View style={styles.oRow}>
            <Text style={styles.oLabel}>Адрес:</Text>
            <Text style={styles.oValue}>{d.address}</Text>
          </View>
          <View style={styles.oRow}>
            <Text style={styles.oLabel}>Дата съёмки:</Text>
            <Text style={styles.oValue}>{d.shotAt}</Text>
          </View>
          <View style={styles.oRow}>
            <Text style={styles.oLabel}>Исходных кадров:</Text>
            <Text style={styles.oValue}>{d.framesUsed}</Text>
          </View>
          <View style={styles.oRowLast}>
            <Text style={styles.oLabel}>3D-модель:</Text>
            <Text style={styles.oValue}>
              {d.glbUrl
                ? <Link src={d.glbUrl} style={styles.oLink}>Открыть 3D-модель объекта</Link>
                : '—'}
            </Text>
          </View>
        </View>

        {/* п.2: вместо таблицы — карточки с главными цифрами,
            масса выделена золотом и кремовой подложкой */}
        <Text style={[styles.secHd, { marginTop: 18 }]}>2. Результат расчёта</Text>
        <View style={styles.sumRow}>
          <View style={styles.sumBox}>
            <Text style={styles.sumLabel}>Материал</Text>
            <Text style={styles.sumValM}>{r.material}</Text>
          </View>
          <View style={styles.sumBox}>
            <Text style={styles.sumLabel}>Объём</Text>
            <Text style={styles.sumVal}>{r.volume} <Text style={styles.sumUnit}>м³</Text></Text>
          </View>
          <View style={styles.sumBox}>
            <Text style={styles.sumLabel}>Плотность</Text>
            <Text style={styles.sumVal}>{r.density} <Text style={styles.sumUnit}>кг/м³</Text></Text>
          </View>
          <View style={[styles.sumBox, styles.sumBoxAccent]}>
            <Text style={styles.sumLabel}>Расчётная масса</Text>
            <Text style={styles.sumVal}>{r.mass} <Text style={styles.sumUnit}>т</Text></Text>
          </View>
        </View>

        <Text style={[styles.secHd, { marginTop: 18 }]}>3. Фотофиксация объекта</Text>
        <View style={styles.photos}>
          {d.photos.map((src, i) => (
            <View key={i} style={styles.photoCol}>
              {src
                ? <Image src={src} style={styles.photoFrame} />
                : <View style={styles.photoStub} />}
              <Text style={styles.photoCap}>{d.photoCaptions[i] || `Кадр ${i + 1}`}</Text>
            </View>
          ))}
        </View>

        <View style={styles.signWrap}>
          <View style={styles.signLine}>
            <Text>Расчёт выполнил:</Text>
            <View style={styles.signRule} />
            <Text>/ {d.performer} /</Text>
          </View>
          <Text>М.П.</Text>
        </View>
        <Text style={styles.dateLine}>Дата составления: {d.dateMade} г.</Text>

        <View style={styles.footer} fixed>
          <Text>Модуль «Karelia Stroy — AI Photo Analysis»</Text>
          <Text>Лист 1 из 1</Text>
          <Text>№ {d.docNo}</Text>
        </View>
      </Page>
    </Document>
  )
}
