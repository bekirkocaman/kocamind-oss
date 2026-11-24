import { useEffect, useMemo, useState } from 'react'
import {
  IconExternalLink,
  IconLoading,
  IconOpenCheckout,
  IconVerifiedProtection,
} from './icons.jsx'
import { API, authFetch, postJSON } from '../lib/api'
import { SettingRow, SettingsGroup } from './settings/Fields'
import './BillingPanel.css'

const EMPTY_CUSTOMER = { name: '', surname: '', identityNumber: '', gsmNumber: '', city: '', district: '', address: '', zipCode: '' }

export default function BillingPanel({ currentUser, showToast, onStatusChange }) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(Boolean(currentUser))
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const initialCustomer = useMemo(() => {
    const parts = String(currentUser?.displayName || '').trim().split(/\s+/).filter(Boolean)
    return { ...EMPTY_CUSTOMER, name: parts[0] || '', surname: parts.slice(1).join(' ') || '' }
  }, [currentUser])
  const [customer, setCustomer] = useState(initialCustomer)

  async function refreshStatus() {
    if (!currentUser) return
    setLoading(true)
    try {
      const response = await authFetch(API.billingStatus)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Plan bilgisi alınamadı.')
      setStatus(data)
      onStatusChange?.(data)
    } catch (error) { showToast(error.message, 'error') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    const timer = window.setTimeout(refreshStatus, 0)
    return () => window.clearTimeout(timer)
  }, [currentUser]) // eslint-disable-line react-hooks/exhaustive-deps
  const activePlan = status?.billing?.status === 'active' ? status.billing.plan : 'free'

  async function startCheckout(event) {
    event.preventDefault()
    if (!currentUser) return showToast('Ödeme için önce giriş yapmalısın.', 'info')
    setSubmitting(true)
    try {
      const result = await postJSON(API.billingCheckout, { planId: 'pro', acceptedTerms, customer })
      window.location.assign(result.checkoutUrl)
    } catch (error) { showToast(error.message, 'error'); setSubmitting(false) }
  }

  async function cancelSubscription() {
    if (!window.confirm('Plus aboneliğini iptal etmek istediğine emin misin?')) return
    setSubmitting(true)
    try {
      await postJSON(API.billingCancel, {})
      showToast('Aboneliğin iptal edildi.', 'success')
      await refreshStatus()
    } catch (error) { showToast(error.message, 'error') }
    finally { setSubmitting(false) }
  }

  if (!currentUser) {
    return (
      <p className="settings-hint">
        Plan ve abonelik bilgilerini görmek için giriş yapmalısın.
      </p>
    )
  }

  const upgradeDisabled = loading || submitting || status?.configured === false

  return <>
    <SettingsGroup>
      <SettingRow
        label={activePlan === 'pro' ? 'Plus plan' : 'Ücretsiz plan'}
        desc={activePlan === 'pro'
          ? '350₺/ay · Yüksek kullanım limitleri, Derin Araştırma ve öncelikli destek'
          : 'Günlük 50 mesaj, 5 görsel, 2 video · Plus: 350₺/ay'}
        control={activePlan === 'pro' ? (
          <button type="button" className="mini-btn" disabled={submitting} onClick={cancelSubscription}>
            Aboneliği iptal et
          </button>
        ) : (
          <button type="button" className="connector-btn primary" disabled={upgradeDisabled} onClick={() => setCheckoutOpen(true)}>
            {loading ? 'Kontrol ediliyor…' : status?.configured === false ? 'Yakında' : "Plus'a geç"}
            {!loading && status?.configured !== false && <IconOpenCheckout size={14} />}
          </button>
        )}
      />
      <SettingRow
        label="Kurumsal plan"
        desc="Ekip yönetimi, özel kullanım kotası, SLA ve destek"
        control={
          <a className="mini-btn billing-contact" href="mailto:bekirkocaman50@gmail.com?subject=KocaMind Kurumsal Plan">
            İletişime geç <IconExternalLink size={13} />
          </a>
        }
      />
    </SettingsGroup>

    {status?.configured === false
      ? <div className="settings-note">Ödeme hesabı bağlanıyor · Tahsilat henüz kapalı.</div>
      : status?.testMode && <div className="settings-note">Test modu · Gerçek ücret çekilmez.</div>}

    {checkoutOpen && <form className="billing-checkout-form" onSubmit={startCheckout}>
      <div className="billing-form-head"><div><strong>Fatura bilgileri</strong><span>Sonraki adımda kartını iyzico’nun güvenli sayfasında gireceksin.</span></div><IconVerifiedProtection size={22} /></div>
      <div className="billing-fields">
        <label>Ad<input value={customer.name} onChange={e => setCustomer({ ...customer, name: e.target.value })} required autoComplete="given-name" /></label>
        <label>Soyad<input value={customer.surname} onChange={e => setCustomer({ ...customer, surname: e.target.value })} required autoComplete="family-name" /></label>
        <label>T.C. kimlik numarası<input value={customer.identityNumber} onChange={e => setCustomer({ ...customer, identityNumber: e.target.value.replace(/\D/g, '').slice(0, 11) })} required inputMode="numeric" /></label>
        <label>Telefon<input value={customer.gsmNumber} onChange={e => setCustomer({ ...customer, gsmNumber: e.target.value })} required placeholder="+90 5xx xxx xx xx" autoComplete="tel" /></label>
        <label>Şehir<input value={customer.city} onChange={e => setCustomer({ ...customer, city: e.target.value })} required autoComplete="address-level1" /></label>
        <label>İlçe<input value={customer.district} onChange={e => setCustomer({ ...customer, district: e.target.value })} required autoComplete="address-level2" /></label>
        <label className="billing-wide">Adres<textarea value={customer.address} onChange={e => setCustomer({ ...customer, address: e.target.value })} required minLength={10} autoComplete="street-address" /></label>
        <label>Posta kodu<input value={customer.zipCode} onChange={e => setCustomer({ ...customer, zipCode: e.target.value })} autoComplete="postal-code" /></label>
      </div>
      <label className="billing-consent"><input type="checkbox" checked={acceptedTerms} onChange={e => setAcceptedTerms(e.target.checked)} required /><span>350₺ tutarın her ay tahsil edilmesini ve <a href="/terms.html" target="_blank" rel="noreferrer">abonelik koşullarını</a> kabul ediyorum.</span></label>
      <div className="billing-form-actions"><button type="button" onClick={() => setCheckoutOpen(false)}>Vazgeç</button><button type="submit" className="plan-upgrade-btn" disabled={submitting || !acceptedTerms}>{submitting ? <><IconLoading className="billing-spin" size={15} /> Açılıyor…</> : 'Güvenli ödemeye geç'}</button></div>
    </form>}

    <div className="settings-section billing-history-section">
      <h4>Fatura geçmişi</h4>
      {status?.invoices?.length ? (
        <SettingsGroup>
          {status.invoices.map(invoice => (
            <div key={invoice.id} className="km-row">
              <div className="km-row-text">
                <span className="km-row-label settings-tabular">{invoice.orderReferenceCode || invoice.id}</span>
              </div>
              <span className={`invoice-status ${invoice.status}`}>{invoice.status === 'paid' ? 'Ödendi' : 'Başarısız'}</span>
            </div>
          ))}
        </SettingsGroup>
      ) : (
        <p className="settings-hint">Henüz fatura kaydı bulunmuyor.</p>
      )}
    </div>
  </>
}
