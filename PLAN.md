# LockPro — Full Platform Plan

## Philosophy
The tech calls the customer back personally. That call is the sale.
The system handles everything up to and after that call — so the tech can focus on the human connection.

## Architecture

### Frontend (static, GitHub Pages)
```
lockpro.frantzenterprise.github.io/
├── index.html              ← Customer intake (LockCMD evolved)
│   └── Flow: Welcome → Select issue → Get estimate → Confirm & Send
├── success.html            ← "We'll call you back ASAP"
├── /tech/
│   ├── dashboard.html      ← Incoming leads, quick actions
│   ├── leads.html          ← History of all jobs
│   └── settings.html       ← Full business config
│       ├── Branding (colors, logo, bg)
│       ├️⃣ Services (per-tab, toggle on/off, custom)
│       ├── Pricing (trip fee, radius, mileage rate, per-service)
│       └── Payments (Stripe keys, Venmo handle, Zelle email)
├── /api/
│   ├── server.js           ← Node.js backend (or serverless)
│   └── routes/
│       ├── leads.js        ─ Save/retrieve leads
│       ├── payments.js     ─ Stripe checkout, confirmations
│       └── notifications.js ─ SMS/email via Twilio/SendGrid
```

### Data Flow
```
Customer → index.html (fills form + gets estimate)
  → "Confirm & Send" → SMS/email to tech (via Twilio/SendGrid)
  → Tech calls customer back → sets appointment
  → Tech does job → sends invoice (Stripe payment link)
  → Customer pays → autoresponder sends receipt
```

### Tech Settings (persisted in localStorage initially, server later)
- bizName, phone, email, country
- accent/accent2/bg colors, logo URL, bg image URL
- tabs shown (resi/comm/auto/safe)
- services per tab (which ones, plus custom)
- tripFee, serviceRadius, mileageRate
- prices per service per tab
- Stripe publishable key, Venmo handle, Zelle email
- SMS/email notification preferences

### Payment Flow
1. Tech configures Stripe keys in settings
2. After job, tech marks "send invoice" → system creates Stripe Payment Link
3. Link sent to customer via SMS/email
4. Customer pays → Stripe webhook → autoresponder sends receipt
5. Venmo/Zelle shown as alternative options

## Build Phases

### Phase 1: Customer Intake + Pricing Engine (NOW)
- LockCMD customer flow working
- Settings drawer with branding, services, pricing
- Confirm & Send (SMS/email) with callback promise
- **Deliverable:** Live at frantzenterprise.github.io/LockCMD/

### Phase 2: Tech Dashboard + Lead Management
- Customer submissions saved (localStorage initially)
- Dashboard shows incoming leads with details
- Mark as "contacted", "appointment set", "completed", "paid"
- Basic lead history

### Phase 3: Payment Integration
- Settings page for Stripe/Venmo/Zelle config
- Stripe Payment Link creation from dashboard
- Payment status tracking per lead
- Venmo/Zelle manual confirmation

### Phase 4: Notifications
- Twilio SMS integration
- SendGrid/Resend email integration
- Auto-confirmation on payment
- Tech notification on new lead

### Phase 5: Polish & Deploy
- Mobile optimization
- Error handling
- Loading states
- Help/tour for first-time techs

## Key Design Decisions
- **No auto-booking** — tech calls customer back (that's the sale)
- **Single-page customer flow** — simple, fast, no navigation
- **Settings in drawer** — quick access for tech
- **Pricing inline with services** — Robert's preference
- **Stripe Payment Links** — no PCI compliance needed client-side
