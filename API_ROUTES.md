# Fresh Up API Routes - Dokumentasjon

## Oversikt

Fresh Up har 7 hovedrouter for å håndtere all serverlogikk:

### 1. GET `/api/services/list`
**Henter hierarkiske data: modes → targets → categories → services**

**Query Parameters:**
- `mode` (optional): Hent targets for en mode
- `target` (optional): Hent categories for mode+target
- `category` (optional): Hent services for mode+target+category

**Eksempler:**
```bash
# Get all modes
GET /api/services/list

# Get targets for beauty mode
GET /api/services/list?mode=beauty

# Get categories for beauty + female
GET /api/services/list?mode=beauty&target=beauty_female

# Get services for beauty + female + nails
GET /api/services/list?mode=beauty&target=beauty_female&category=beauty_female_nails
```

**Response:**
```json
{
  "modes": [
    { "id": "beauty", "label": "Beauty", "icon": "sparkles", "sort_order": 1 },
    ...
  ]
}
```

---

### 2. POST `/api/orders/book`
**Kunde booker en tjeneste → system finner matching providers → sender offers**

**Request Body:**
```json
{
  "customer_id": "uuid",
  "service_id": "skin_fade",
  "delivery_mode": "home",
  "customer_lat": 59.9139,
  "customer_lng": 10.7522,
  "customer_address": "Storgata 1, Oslo",
  "scheduled_at": "2026-04-07T14:00:00Z",
  "notes": "Please arrive on time"
}
```

**Response:**
```json
{
  "order": {
    "id": "uuid",
    "status": "pending",
    "customer_id": "uuid",
    ...
  },
  "offers_sent": 3
}
```

**Hva skjer:**
1. Order opprettes med status "pending"
2. Systemet finner opp til 5 matching providers (nærmeste, høyest rating)
3. Order offers sendes til hver provider (med 30 sekunder timeout)
4. Provider ser offeret i sitt dashboard

---

### 3. POST `/api/orders/accept`
**Provider aksepterer offer → første som klikker vinner → andre offers deklineres**

**Request Body:**
```json
{
  "offer_id": "uuid",
  "provider_id": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "order_id": "uuid"
}
```

**Atomisk operasjon:**
- Accept off er marked som "accepted"
- Alle andre offers for samme order marked som "declined"
- Order status oppdatert til "accepted"
- Provider_id assigned til order

---

### 4. POST `/api/providers/onboard`
**Provider registrerer seg og velger modes/targets/categories/services**

**Request Body:**
```json
{
  "business_name": "Oslo Barbershop",
  "description": "Professional barber services",
  "phone": "+47 12345678",
  "address": "Ferner Jacobsens gate 2, Oslo",
  "lat": 59.9139,
  "lng": 10.7522,
  "radius_km": 15,
  "delivery_modes": ["home", "at_provider"],
  "mode_selections": [
    {
      "mode_id": "beauty",
      "targets": ["beauty_male", "beauty_female"],
      "categories": ["beauty_male_haircut", "beauty_female_nails"],
      "services": [
        { "service_id": "skin_fade", "competence_rating": 5 },
        { "service_id": "manicure", "competence_rating": 4 }
      ]
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "provider_id": "uuid"
}
```

---

### 5. GET/PUT `/api/providers/me`
**Hent eller oppdater provider profil**

**GET Response:**
```json
{
  "provider": {
    "id": "uuid",
    "business_name": "Oslo Barbershop",
    "is_online": true,
    "avg_rating": 4.8,
    ...
  },
  "modes": ["beauty", "vehicle"],
  "targets": ["beauty_male", "vehicle_car"],
  "skills": [
    { "service_id": "skin_fade", "competence_rating": 5 }
  ]
}
```

**PUT Body:**
```json
{
  "business_name": "Updated Name",
  "phone": "+47 98765432"
}
```

---

### 6. POST `/api/providers/online`
**Toggle provider online/offline status**

**Request Body:**
```json
{
  "is_online": true
}
```

**Response:**
```json
{
  "success": true,
  "is_online": true
}
```

---

### 7. GET `/api/orders/list`
**Hent orders for customer eller provider**

**Headers Required:**
- `x-user-id`: User UUID
- `x-user-type`: "customer" eller "provider"

**Query Parameters:**
- `status` (optional): "pending", "accepted", "completed", osv

**Response:**
```json
{
  "orders": [
    {
      "id": "uuid",
      "service_id": "skin_fade",
      "status": "accepted",
      "customer_id": "uuid",
      "provider_id": "uuid",
      ...
    }
  ]
}
```

---

### 8. POST `/api/ratings/create`
**Kunde eller provider gir rating etter completed order**

**Request Body:**
```json
{
  "order_id": "uuid",
  "rating": 5,
  "comment": "Great service!"
}
```

**Response:**
```json
{
  "success": true
}
```

---

## Matching Algorithm

`find_matching_providers()` fungerer slik:

1. **Find providers med service skill:**
   - Service må være i provider_skills
   - Provider må være online (is_online = true)
   - Skill må være aktiv

2. **Kalkuler geografisk distanse:**
   - Haversine formula for great-circle distance
   - Max 15km som standard

3. **Sorter providere:**
   1. Nærmeste først (ascending distance)
   2. Deretter høyeste rating
   3. Deretter høyeste competence rating

4. **Begrens til 5 providers:**
   - Lager offers for første 5 matchende providers

5. **Timeout 30 sekunder:**
   - Provider har 30 sekunder for å akseptere
   - Offer blir "expired" etter 30 sekunder

---

## Error Handling

Alle ruter returnerer standard error format:

```json
{
  "error": "Descriptive error message"
}
```

**Status Codes:**
- 200: OK
- 400: Bad Request (missing fields)
- 401: Unauthorized (missing auth)
- 403: Forbidden (not allowed)
- 404: Not Found
- 500: Server Error

---

## Sikkerhet

- **RLS policies:** Alle tabeller har Row Level Security aktivert
- **Auth header:** Sensitive ruter sjekker `x-provider-id` eller `x-user-id` header
- **Atomisk matching:** Accept-ruten er atomisk for å unngå race conditions
- **Input validation:** Alle inputs valideres før DB-operasjoner
