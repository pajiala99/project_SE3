"""Hard eligibility filters (spec §9) + progressive radius expansion (§11).

A recipient is eligible for a donation at search radius R only if ALL hold:

1. recipient is active
2. remaining capacity (servingCapacity - assignedServings - reserved this
   cycle) >= donation.quantityServings
3. distance <= min(R, recipient.serviceRadiusKm)
4. food type compatible (empty foodPreferences = accepts everything)
5. pickup can realistically happen: minutes until min(expiresAt, pickupEnd)
   >= config.minPickupFeasibilityMinutes
6. pair not in exclusions (e.g. recipient previously rejected this donation)

Radius expansion: start at initialRadiusKm; if no eligible recipient, expand
by radiusStepKm up to maxRadiusKm; if still none, the donation is waitlisted
(it is never silently dropped).
"""

from datetime import datetime
from typing import Dict, List, Optional, Set, Tuple

from geo import haversine_km
from models import (
    CandidateExplanation,
    DonationIn,
    MatchConfig,
    PairDistanceMap,
    RecipientIn,
)


def pair_distance_km(
    donation: DonationIn,
    recipient: RecipientIn,
    pair_distances: PairDistanceMap,
) -> float:
    """Prefer PostGIS-computed distance; fall back to haversine."""
    d = pair_distances.get((donation.donationId, recipient.recipientId))
    if d is not None:
        return d
    return haversine_km(donation.latitude, donation.longitude, recipient.latitude, recipient.longitude)


def minutes_until_expiry(donation: DonationIn, now: datetime) -> float:
    return (donation.expiresAt - now).total_seconds() / 60.0


def _pickup_window_minutes(donation: DonationIn, now: datetime) -> float:
    deadline = donation.expiresAt
    if donation.pickupEnd is not None and donation.pickupEnd < deadline:
        deadline = donation.pickupEnd
    return (deadline - now).total_seconds() / 60.0


def ineligibility_reasons(
    donation: DonationIn,
    recipient: RecipientIn,
    distance_km: float,
    search_radius_km: float,
    reserved_servings: float,
    excluded: Set[Tuple[str, str]],
    config: MatchConfig,
    now: datetime,
) -> List[str]:
    """All hard-constraint violations for a pair (empty list = eligible)."""
    reasons: List[str] = []

    if (donation.donationId, recipient.recipientId) in excluded:
        reasons.append("recipient previously rejected this donation (excluded from immediate retry)")

    if not recipient.active:
        reasons.append("recipient is inactive")

    remaining = recipient.available_capacity - reserved_servings
    if remaining < donation.quantityServings:
        reasons.append(
            f"insufficient remaining capacity ({remaining:.0f} servings free < "
            f"{donation.quantityServings} needed)"
        )

    effective_radius = min(search_radius_km, recipient.serviceRadiusKm)
    if distance_km > effective_radius:
        reasons.append(
            f"outside radius ({distance_km:.1f} km > {effective_radius:.1f} km)"
        )

    if recipient.foodPreferences and donation.foodType not in recipient.foodPreferences:
        reasons.append(f"does not accept food type '{donation.foodType}'")

    # SRS NFR-7: a recipient's declared dietary restrictions list food types it
    # must never be sent; this is a hard constraint, checked before scoring.
    restricted = {r.strip().lower() for r in recipient.dietaryRestrictions}
    if donation.foodType.strip().lower() in restricted:
        reasons.append(f"dietary restriction excludes food type '{donation.foodType}'")

    window = _pickup_window_minutes(donation, now)
    if window < config.minPickupFeasibilityMinutes:
        reasons.append(
            f"pickup not realistic: {window:.0f} min left "
            f"(< {config.minPickupFeasibilityMinutes:.0f} min minimum window)"
        )

    return reasons


def eligible_at_radius(
    donation: DonationIn,
    recipients: List[RecipientIn],
    search_radius_km: float,
    reserved: Dict[str, float],
    excluded: Set[Tuple[str, str]],
    pair_distances: PairDistanceMap,
    config: MatchConfig,
    now: datetime,
) -> Tuple[List[Tuple[RecipientIn, float]], List[CandidateExplanation]]:
    """Eligible (recipient, distance) pairs at the given radius, plus a
    per-candidate explanation list for auditability. Deterministic order
    (sorted by recipient id)."""
    eligible: List[Tuple[RecipientIn, float]] = []
    explanations: List[CandidateExplanation] = []

    for recipient in sorted(recipients, key=lambda r: r.recipientId):
        distance = pair_distance_km(donation, recipient, pair_distances)
        reasons = ineligibility_reasons(
            donation, recipient, distance, search_radius_km,
            reserved.get(recipient.recipientId, 0.0), excluded, config, now,
        )
        if reasons:
            explanations.append(
                CandidateExplanation(
                    recipientId=recipient.recipientId,
                    eligible=False,
                    reasons=reasons,
                    distanceKm=round(distance, 4),
                )
            )
        else:
            eligible.append((recipient, distance))

    return eligible, explanations


def expand_radius_until_eligible(
    donation: DonationIn,
    recipients: List[RecipientIn],
    reserved: Dict[str, float],
    excluded: Set[Tuple[str, str]],
    pair_distances: PairDistanceMap,
    config: MatchConfig,
    now: datetime,
) -> Tuple[List[Tuple[RecipientIn, float]], float, List[CandidateExplanation]]:
    """Progressive radius expansion (spec §11). Returns (eligible, radius_used,
    explanations from the final radius tried)."""
    radius = config.initialRadiusKm
    explanations: List[CandidateExplanation] = []
    while True:
        eligible, explanations = eligible_at_radius(
            donation, recipients, radius, reserved, excluded, pair_distances, config, now,
        )
        if eligible or radius >= config.maxRadiusKm:
            return eligible, radius, explanations
        radius = min(radius + config.radiusStepKm, config.maxRadiusKm)
