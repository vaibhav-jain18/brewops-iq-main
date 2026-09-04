import {
  getMember,
  getMenu,
  getOffers,
  type Member,
  type Offer,
} from '../data'

export interface CartLine {
  productId: string
  qty: number
}

export interface PriceTicketInput {
  lines: CartLine[]
  memberId: string | null
  date: string
}

export interface PricedLine {
  productId: string
  qty: number
  unitPrice: number
  gross: number
  appliedOfferId: string | null
  discount: number
  net: number
}

export interface PricedTicket {
  lines: PricedLine[]
  orderLevel: { appliedOfferId: string | null; discount: number }
  subtotal: number
  total: number
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export function round2(value: number): number {
  const correction = Number.EPSILON * Math.max(1, Math.abs(value))
  return Math.round((value + correction) * 100) / 100
}

function isOfferAvailable(offer: Offer, date: string, member: Member | null): boolean {
  if (date < offer.validFrom || date > offer.validTo) return false

  if (offer.eligibleTiers && (!member || !offer.eligibleTiers.includes(member.tier))) {
    return false
  }

  if (offer.dayOfWeek) {
    const [year, month, day] = date.split('-').map(Number)
    const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
    if (!offer.dayOfWeek.includes(weekday)) return false
  }

  return true
}

function winsTie(candidate: Offer, current: Offer): boolean {
  if (candidate.validFrom !== current.validFrom) {
    return candidate.validFrom < current.validFrom
  }
  return candidate.id.localeCompare(current.id) < 0
}

export function priceTicket(input: PriceTicketInput): PricedTicket {
  const menuById = new Map(getMenu().map((item) => [item.id, item]))
  const member = input.memberId === null ? null : getMember(input.memberId)
  if (input.memberId !== null && !member) {
    throw new Error(`Unknown member: ${input.memberId}`)
  }

  const quantities = new Map<string, number>()
  for (const line of input.lines) {
    if (!menuById.has(line.productId)) {
      throw new Error(`Unknown product: ${line.productId}`)
    }
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      throw new Error(`Invalid qty for ${line.productId}`)
    }
    quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.qty)
  }

  const availableOffers = getOffers().filter((offer) =>
    isOfferAvailable(offer, input.date, member ?? null),
  )

  const lines = input.lines.map<PricedLine>((line) => {
    const menuItem = menuById.get(line.productId)!
    const gross = round2(menuItem.basePrice * line.qty)
    let winningOffer: Offer | null = null
    let winningDiscount = 0

    for (const offer of availableOffers) {
      let discount = 0

      if (offer.type === 'percent_off') {
        const matchesCategory = offer.scope.category === menuItem.category
        const matchesProduct = offer.scope.productIds?.includes(line.productId) ?? false
        if (matchesCategory || matchesProduct) {
          discount = round2(gross * offer.percent / 100)
        }
      } else if (offer.type === 'bundle' && offer.products[0] === line.productId) {
        const pairs = Math.min(
          quantities.get(offer.products[0]) ?? 0,
          quantities.get(offer.products[1]) ?? 0,
        )
        discount = round2(pairs * offer.amountOff)
      }

      discount = Math.min(gross, discount)
      if (
        discount > 0
        && (
          discount > winningDiscount
          || (discount === winningDiscount && winningOffer !== null && winsTie(offer, winningOffer))
        )
      ) {
        winningOffer = offer
        winningDiscount = discount
      }
    }

    return {
      productId: line.productId,
      qty: line.qty,
      unitPrice: menuItem.basePrice,
      gross,
      appliedOfferId: winningOffer?.id ?? null,
      discount: round2(winningDiscount),
      net: round2(Math.max(0, gross - winningDiscount)),
    }
  })

  const subtotal = round2(lines.reduce((sum, line) => sum + line.net, 0))
  let orderOffer: Offer | null = null
  let orderDiscount = 0

  for (const offer of availableOffers) {
    if (offer.type !== 'spend_threshold') continue

    const qualifyingAmount = offer.category === undefined
      ? subtotal
      : round2(lines.reduce((sum, line) => {
          const menuItem = menuById.get(line.productId)!
          return menuItem.category === offer.category ? sum + line.net : sum
        }, 0))

    if (
      qualifyingAmount >= offer.minSubtotal
      && (
        offer.amountOff > orderDiscount
        || (offer.amountOff === orderDiscount && orderOffer !== null && winsTie(offer, orderOffer))
      )
    ) {
      orderOffer = offer
      orderDiscount = offer.amountOff
    }
  }

  orderDiscount = round2(orderDiscount)
  return {
    lines,
    orderLevel: {
      appliedOfferId: orderOffer?.id ?? null,
      discount: orderDiscount,
    },
    subtotal,
    total: round2(Math.max(0, subtotal - orderDiscount)),
  }
}