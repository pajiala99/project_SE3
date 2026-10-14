"""Canonical FoodBridge scoring (spec §9): urgency + proximity + capacity/need.

    totalScore = w_u * urgencyScore + w_p * proximityScore + w_c * capacityScore

- urgencyScore   (donation-level) — also determines processing ORDER in greedy:
                 the most urgent donation is matched first. 1.0 = expiring now.
- proximityScore (pair-level)     — 1 - distance / maxRadiusKm.
- capacityScore  (recipient-level)— available / servingCapacity: relative need.

Weights are configurable engineering parameters (see MATCHING_WEIGHTS defaults
in models.Weights), explicitly NOT scientifically optimal constants.
Fairness was part of an earlier, incorrect prototype and is NOT in the
canonical formula.
"""

from typing import Tuple

from models import DonationIn, MatchConfig, RecipientIn

ROUND = 4


def clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def urgency_score(minutes_until_expiry: float, horizon_minutes: float) -> float:
    if horizon_minutes <= 0:
        return 1.0
    return clamp01(1.0 - minutes_until_expiry / horizon_minutes)


def proximity_score(distance_km: float, max_radius_km: float) -> float:
    if max_radius_km <= 0:
        return 0.0
    return clamp01(1.0 - distance_km / max_radius_km)


def capacity_score(available_capacity: float, serving_capacity: float) -> float:
    """Capacity/need ratio: how much of the organisation's serving capacity is
    still unmet. Higher need -> higher score."""
    if serving_capacity <= 0:
        return 0.0
    return clamp01(available_capacity / serving_capacity)


def score_pair(
    donation: DonationIn,
    recipient: RecipientIn,
    distance_km: float,
    minutes_until_expiry: float,
    config: MatchConfig,
    reserved_servings: float = 0.0,
) -> Tuple[float, float, float, float]:
    """Return (total, urgency, proximity, capacity) for one pair, rounded."""
    u = urgency_score(minutes_until_expiry, config.urgencyHorizonMinutes)
    p = proximity_score(distance_km, config.maxRadiusKm)
    c = capacity_score(recipient.available_capacity - reserved_servings, recipient.servingCapacity)
    total = (
        config.weights.urgency * u
        + config.weights.proximity * p
        + config.weights.capacity * c
    )
    return round(total, ROUND), round(u, ROUND), round(p, ROUND), round(c, ROUND)
