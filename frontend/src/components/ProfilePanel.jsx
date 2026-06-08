import { useState, useEffect, useRef } from 'react'
import { X, Save, Bot, FileText, RefreshCw, Plus, Trash2, ChevronDown, ChevronUp, Upload, File } from 'lucide-react'

const EMPTY_PROFILE = {
  businessName:'', industry:'', location:'', about:'',
  phone:'', email:'', whatsapp:'', website:'', hours:'',
  services:[{ name:'', description:'', price:'' }],
  faqs:[{ q:'', a:'' }],
  paymentMethods:'', refundPolicy:'', deliveryInfo:'',
  languages:'', botPersona:'', extraContext:'',
}

function Section({ title, open, onToggle, children }) {
  return (
    <div className="border border-wa-border rounded-xl overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 bg-wa-card hover:bg-wa-active transition-colors text-left">
        <span className="text-wa-text font-medium text-[13px]">{title}</span>
        {open ? <ChevronUp size={14} className="text-wa-muted"/> : <ChevronDown size={14} className="text-wa-muted"/>}
      </button>
      {open && <div className="px-4 py-4 bg-wa-bg flex flex-col gap-3">{children}</div>}
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-wa-muted text-[11px] uppercase tracking-wider font-semibold">{label}</label>
      {hint && <p className="text-wa-muted/70 text-[11px]">{hint}</p>}
      {children}
    </div>
  )
}

const inp = "w-full bg-wa-card border border-wa-border rounded-lg px-3 py-2 text-wa-text text-[13px] placeholder:text-wa-muted outline-none focus:border-wa-green/50 transition-colors"
const ta  = inp + " resize-none"

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`
  return `${(bytes/1024/1024).toFixed(1)} MB`
}

function buildDocText(p) {
  const lines = []
  if (p.businessName) lines.push(`Company: ${p.businessName}`)
  if (p.industry)     lines.push(`Industry: ${p.industry}`)
  if (p.location)     lines.push(`Location: ${p.location}`)
  if (p.about)        lines.push(`\nAbout:\n${p.about}`)
  if (p.phone || p.email || p.whatsapp || p.website) {
    lines.push('\nContact:')
    if (p.phone)    lines.push(`Phone: ${p.phone}`)
    if (p.whatsapp) lines.push(`WhatsApp: ${p.whatsapp}`)
    if (p.email)    lines.push(`Email: ${p.email}`)
    if (p.website)  lines.push(`Website: ${p.website}`)
  }
  if (p.hours) lines.push(`\nWorking Hours:\n${p.hours}`)
  const svcs = (p.services||[]).filter(s=>s.name)
  if (svcs.length) {
    lines.push('\nServices:')
    svcs.forEach((s,i)=>lines.push(`${i+1}. ${s.name}${s.price?` — ${s.price}`:''}${s.description?`\n   ${s.description}`:''}`) )
  }
  if (p.paymentMethods) lines.push(`\nPayment Methods:\n${p.paymentMethods}`)
  if (p.refundPolicy)   lines.push(`\nRefund Policy:\n${p.refundPolicy}`)
  if (p.deliveryInfo)   lines.push(`\nDelivery / Turnaround:\n${p.deliveryInfo}`)
  if (p.languages)      lines.push(`\nLanguages Supported: ${p.languages}`)
  const faqs = (p.faqs||[]).filter(f=>f.q&&f.a)
  if (faqs.length) { lines.push('\nFrequently Asked Questions:'); faqs.forEach(f=>lines.push(`Q: ${f.q}\nA: ${f.a}`)) }
  if (p.botPersona)   lines.push(`\nBot Persona / Tone:\n${p.botPersona}`)
  if (p.extraContext) lines.push(`\nAdditional Context:\n${p.extraContext}`)
  return lines.join('\n')
}

export default function ProfilePanel({ onClose }) {
  const [profile, setProfile]     = useState(EMPTY_PROFILE)
  const [settings, setSettings]   = useState(null)
  const [docs, setDocs]           = useState([])
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [loading, setLoading]     = useState(true)
  const [uploading, setUploading] = useState(false)
  const [activeTab, setActiveTab] = useState('profile')
  const [openSections, setOpenSections] = useState({ basic:true, contact:true, services:true, hours:false, policies:false, faq:false, bot:false, docs:true })
  const fileRef = useRef()

  const toggle = k => setOpenSections(p=>({...p,[k]:!p[k]}))
  const set    = (k,v) => setProfile(p=>({...p,[k]:v}))

  const fetchDocs = () => fetch('/api/docs').then(r=>r.json()).then(setDocs).catch(()=>{})

  useEffect(() => {
    Promise.all([
      fetch('/api/profile').then(r=>r.json()),
      fetch('/api/docs').then(r=>r.json())
    ]).then(([profileData, docsData]) => {
      setSettings(profileData.settings||{})
      setDocs(docsData||[])
      if (profileData.content) {
        const raw = profileData.content
        const extract = key => { const m=raw.match(new RegExp(`${key}:\\s*(.+)`)); return m?m[1].trim():'' }
        setProfile(p=>({...p,
          businessName:extract('Company'), industry:extract('Industry'),
          location:extract('Location')||extract('Headquarters'),
          phone:extract('Phone'), email:extract('Email'),
          whatsapp:extract('WhatsApp'), website:extract('Website'),
          extraContext:raw,
        }))
      }
      setLoading(false)
    }).catch(()=>setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await fetch('/api/profile', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ content:buildDocText(profile) }) })
      setSaved(true); setTimeout(()=>setSaved(false),2500)
    } catch {}
    setSaving(false)
  }

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files)
    if (!files.length) return
    setUploading(true)
    for (const file of files) {
      try {
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload  = () => resolve(reader.result.split(',')[1]) // base64
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
        await fetch('/api/docs/upload', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({ filename:file.name, data })
        })
      } catch (err) { console.error('Upload failed:', err) }
    }
    await fetchDocs()
    setUploading(false)
    e.target.value = ''
  }

  const deleteDoc = async (name) => {
    await fetch(`/api/docs/${encodeURIComponent(name)}`, { method:'DELETE' })
    await fetchDocs()
  }

  const addService = () => setProfile(p=>({...p,services:[...p.services,{name:'',description:'',price:''}]}))
  const updSvc = (i,k,v) => setProfile(p=>{const s=[...p.services];s[i]={...s[i],[k]:v};return{...p,services:s}})
  const delSvc = i => setProfile(p=>({...p,services:p.services.filter((_,j)=>j!==i)}))

  const addFaq = () => setProfile(p=>({...p,faqs:[...p.faqs,{q:'',a:''}]}))
  const updFaq = (i,k,v) => setProfile(p=>{const f=[...p.faqs];f[i]={...f[i],[k]:v};return{...p,faqs:f}})
  const delFaq = i => setProfile(p=>({...p,faqs:p.faqs.filter((_,j)=>j!==i)}))

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose}/>
      <div className="relative w-[520px] h-full bg-wa-sidebar border-l border-black/30 flex flex-col shadow-2xl">

        <div className="flex items-center justify-between px-5 py-4 bg-wa-header border-b border-black/20 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-wa-green flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>
            </div>
            <div>
              <h2 className="text-wa-text font-semibold text-[15px]">Business Profile</h2>
              <p className="text-wa-muted text-[12px]">AI knowledge base</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-wa-muted hover:text-wa-text hover:bg-wa-card transition-colors"><X size={18}/></button>
        </div>

        <div className="flex border-b border-wa-border/50 flex-shrink-0">
          {[['profile',<FileText size={13}/>,'Business Info'],['settings',<Bot size={13}/>,'Bot Settings']].map(([tab,icon,label])=>(
            <button key={tab} onClick={()=>setActiveTab(tab)}
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-[13px] font-medium transition-colors ${activeTab===tab?'text-wa-green border-b-2 border-wa-green bg-wa-green/5':'text-wa-muted hover:text-wa-text'}`}>
              {icon}{label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center"><RefreshCw size={20} className="animate-spin text-wa-muted"/></div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {activeTab==='profile' && (
              <div className="p-4 flex flex-col gap-3">
                <div className="bg-wa-green/10 border border-wa-green/30 rounded-xl px-4 py-2.5">
                  <p className="text-wa-green text-[12px]">Every field you fill in becomes part of the AI's knowledge. The more detail, the better it answers.</p>
                </div>

                <Section title="🏢 Business Basics" open={openSections.basic} onToggle={()=>toggle('basic')}>
                  <Field label="Business Name"><input className={inp} placeholder="e.g. TechNova Solutions" value={profile.businessName} onChange={e=>set('businessName',e.target.value)}/></Field>
                  <Field label="Industry"><input className={inp} placeholder="e.g. Software & IT Services" value={profile.industry} onChange={e=>set('industry',e.target.value)}/></Field>
                  <Field label="Location"><input className={inp} placeholder="e.g. Chennai, India" value={profile.location} onChange={e=>set('location',e.target.value)}/></Field>
                  <Field label="About" hint="2-3 sentences about what you do"><textarea className={ta} rows={3} placeholder="We specialize in..." value={profile.about} onChange={e=>set('about',e.target.value)}/></Field>
                  <Field label="Languages Supported"><input className={inp} placeholder="e.g. English, Tamil, Hindi" value={profile.languages} onChange={e=>set('languages',e.target.value)}/></Field>
                </Section>

                <Section title="📞 Contact Details" open={openSections.contact} onToggle={()=>toggle('contact')}>
                  <Field label="Phone"><input className={inp} placeholder="+91 98765 43210" value={profile.phone} onChange={e=>set('phone',e.target.value)}/></Field>
                  <Field label="WhatsApp"><input className={inp} placeholder="+91 98765 43210" value={profile.whatsapp} onChange={e=>set('whatsapp',e.target.value)}/></Field>
                  <Field label="Email"><input className={inp} placeholder="support@yourbusiness.com" value={profile.email} onChange={e=>set('email',e.target.value)}/></Field>
                  <Field label="Website"><input className={inp} placeholder="https://yourbusiness.com" value={profile.website} onChange={e=>set('website',e.target.value)}/></Field>
                  <Field label="Working Hours"><textarea className={ta} rows={3} placeholder={"Mon–Fri: 9am–6pm\nSat: 10am–2pm\nSun: Closed"} value={profile.hours} onChange={e=>set('hours',e.target.value)}/></Field>
                </Section>

                <Section title="⚡ Services / Products" open={openSections.services} onToggle={()=>toggle('services')}>
                  {profile.services.map((s,i)=>(
                    <div key={i} className="bg-wa-card border border-wa-border rounded-xl p-3 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-wa-muted text-[11px] uppercase tracking-wider font-semibold">Service {i+1}</span>
                        {profile.services.length>1 && <button onClick={()=>delSvc(i)} className="text-red-400 hover:text-red-300"><Trash2 size={12}/></button>}
                      </div>
                      <input className={inp} placeholder="Service name" value={s.name} onChange={e=>updSvc(i,'name',e.target.value)}/>
                      <input className={inp} placeholder="Price (e.g. Starting at ₹25,000)" value={s.price} onChange={e=>updSvc(i,'price',e.target.value)}/>
                      <textarea className={ta} rows={2} placeholder="Brief description..." value={s.description} onChange={e=>updSvc(i,'description',e.target.value)}/>
                    </div>
                  ))}
                  <button onClick={addService} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-wa-border text-wa-muted hover:text-wa-text hover:border-wa-green/50 text-[13px] transition-colors">
                    <Plus size={13}/> Add another service
                  </button>
                </Section>

                <Section title="💳 Policies & Payment" open={openSections.policies} onToggle={()=>toggle('policies')}>
                  <Field label="Payment Methods"><textarea className={ta} rows={2} placeholder="UPI, Bank Transfer, Credit/Debit cards." value={profile.paymentMethods} onChange={e=>set('paymentMethods',e.target.value)}/></Field>
                  <Field label="Refund Policy"><textarea className={ta} rows={2} placeholder="Refunds available within 7 days..." value={profile.refundPolicy} onChange={e=>set('refundPolicy',e.target.value)}/></Field>
                  <Field label="Delivery / Turnaround Time"><textarea className={ta} rows={2} placeholder="Websites: 2-3 weeks. Apps: 6-10 weeks." value={profile.deliveryInfo} onChange={e=>set('deliveryInfo',e.target.value)}/></Field>
                </Section>

                <Section title="❓ FAQs" open={openSections.faq} onToggle={()=>toggle('faq')}>
                  {profile.faqs.map((f,i)=>(
                    <div key={i} className="bg-wa-card border border-wa-border rounded-xl p-3 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-wa-muted text-[11px] uppercase tracking-wider font-semibold">FAQ {i+1}</span>
                        {profile.faqs.length>1 && <button onClick={()=>delFaq(i)} className="text-red-400 hover:text-red-300"><Trash2 size={12}/></button>}
                      </div>
                      <input className={inp} placeholder="Customer question..." value={f.q} onChange={e=>updFaq(i,'q',e.target.value)}/>
                      <textarea className={ta} rows={2} placeholder="Your answer..." value={f.a} onChange={e=>updFaq(i,'a',e.target.value)}/>
                    </div>
                  ))}
                  <button onClick={addFaq} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-wa-border text-wa-muted hover:text-wa-text hover:border-wa-green/50 text-[13px] transition-colors">
                    <Plus size={13}/> Add another FAQ
                  </button>
                </Section>

                <Section title="🤖 Bot Persona" open={openSections.bot} onToggle={()=>toggle('bot')}>
                  <Field label="Tone & Style" hint="How should the bot talk?">
                    <textarea className={ta} rows={3} placeholder={"Be friendly, professional and concise.\nReply in the customer's language."} value={profile.botPersona} onChange={e=>set('botPersona',e.target.value)}/>
                  </Field>
                  <Field label="Extra Context">
                    <textarea className={ta} rows={3} placeholder="Promotions, special instructions, anything else..." value={profile.extraContext} onChange={e=>set('extraContext',e.target.value)}/>
                  </Field>
                </Section>

                {/* ── Business Documents ── */}
                <Section title="📁 Business Documents" open={openSections.docs} onToggle={()=>toggle('docs')}>
                  <p className="text-wa-muted text-[12px] leading-relaxed">
                    Upload any business documents — price lists, catalogues, brochures, policies. The AI will read and use them to answer customers.
                    <br/><span className="text-wa-green">Supported: PDF, TXT, DOCX, MD, CSV</span>
                  </p>

                  {/* Upload zone */}
                  <div
                    onClick={()=>fileRef.current?.click()}
                    className="border-2 border-dashed border-wa-border hover:border-wa-green/50 rounded-xl px-4 py-6 flex flex-col items-center gap-2 cursor-pointer transition-colors group">
                    <Upload size={20} className="text-wa-muted group-hover:text-wa-green transition-colors"/>
                    <p className="text-wa-muted text-[13px] group-hover:text-wa-text transition-colors">
                      {uploading ? 'Uploading…' : 'Click to upload documents'}
                    </p>
                    <p className="text-wa-muted/60 text-[11px]">PDF, TXT, DOCX, MD, CSV</p>
                  </div>
                  <input ref={fileRef} type="file" multiple accept=".pdf,.txt,.docx,.doc,.md,.csv" className="hidden" onChange={handleFileUpload}/>

                  {/* File list */}
                  {docs.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {docs.map(doc => (
                        <div key={doc.name} className="flex items-center gap-3 bg-wa-card border border-wa-border rounded-xl px-3 py-2.5">
                          <File size={14} className="text-wa-green flex-shrink-0"/>
                          <div className="flex-1 min-w-0">
                            <p className="text-wa-text text-[13px] truncate">{doc.name}</p>
                            <p className="text-wa-muted text-[11px]">{fmtSize(doc.size)}</p>
                          </div>
                          {doc.name !== 'company_info.txt' && (
                            <button onClick={()=>deleteDoc(doc.name)} className="text-wa-muted hover:text-red-400 transition-colors flex-shrink-0">
                              <Trash2 size={13}/>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="text-wa-muted/70 text-[11px]">AI will use this document automatically — no restart needed.</p>
                </Section>

                <button onClick={save} disabled={saving}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-wa-green hover:bg-wa-green-light text-white font-semibold text-[14px] transition-all disabled:opacity-50 shadow-lg shadow-wa-green/20 mt-2">
                  {saving?<RefreshCw size={15} className="animate-spin"/>:<Save size={15}/>}
                  {saved?'Saved ✓':saving?'Saving…':'Save & Update AI Knowledge'}
                </button>
                <p className="text-wa-muted text-[11px] text-center pb-4">AI knowledge updates automatically after saving.</p>
              </div>
            )}

            {activeTab==='settings' && settings && (
              <div className="p-4 flex flex-col gap-3">
                {[['Bot Name',settings.botName],['Ollama Model',settings.ollamaModel],['Ollama URL',settings.ollamaUrl],['RAG Server URL',settings.ragServerUrl],['Typing Delay',`${settings.typingDelay}ms`],['History TTL',`${settings.historyTtlH}h`]].map(([label,value])=>(
                  <div key={label} className="bg-wa-card border border-wa-border rounded-xl px-4 py-3">
                    <p className="text-wa-muted text-[11px] uppercase tracking-wider font-semibold">{label}</p>
                    <p className="text-wa-text text-[13px] mt-0.5">{value}</p>
                  </div>
                ))}
                <div className="bg-wa-card border border-wa-border/50 rounded-xl px-4 py-3">
                  <p className="text-wa-muted text-[12px] leading-relaxed">Edit your <code className="text-wa-green">.env</code> file and restart to change these.</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
