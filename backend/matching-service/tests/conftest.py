from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from models import (  # noqa: E402
    DonationIn,
    Exclusion,
    MatchConfig,
    MatchRequest,
    PairDistance,
    RecipientIn,
    Weights,
)

NOW = datetime(2026, 9, 6, 10, 0, 0, tzinfo=timezone.utc)

# Donor hub used across tests (Bengaluru-ish).
HUB = (12.9716, 77.5946)


def make_donation(
    donation_id: str,
    qty: int = 20,
    food: str = "cooked_meals",
    lat: float = HUB[0],
    lng: float = HUB[1],
    expires_in_min: float = 240,
    pickup_end_in_min: float | None = None,
) -> DonationIn:
    return DonationIn(
        donationId=donation_id,
        foodType=food,
        quantityServings=qty,
        latitude=lat,
        longitude=lng,
        postedAt=NOW - timedelta(minutes=10),
        expiresAt=NOW + timedelta(minutes=expires_in_min),
        pickupStart=NOW,
        pickupEnd=NOW + timedelta(minutes=pickup_end_in_min) if pickup_end_in_min else None,
    )


def make_recipient(
    recipient_id: str,
    lat: float,
    lng: float,
    capacity: int = 100,
    assigned: int = 0,
    radius: float = 25.0,
    prefs: tuple = (),
    active: bool = True,
    restrictions: tuple = (),
) -> RecipientIn:
    return RecipientIn(
        recipientId=recipient_id,
        name=recipient_id,
        latitude=lat,
        longitude=lng,
        servingCapacity=capacity,
        assignedServings=assigned,
        serviceRadiusKm=radius,
        foodPreferences=list(prefs),
        dietaryRestrictions=list(restrictions),
        active=active,
    )


def make_request(
    donations,
    recipients,
    strategy: str = "greedy",
    exclusions=(),
    weights: Weights | None = None,
    initial_radius: float = 5.0,
    max_radius: float = 25.0,
    step: float = 5.0,
    now: datetime = NOW,
) -> MatchRequest:
    return MatchRequest(
        donations=donations,
        recipients=recipients,
        exclusions=list(exclusions),
        pairDistances=[],
        config=MatchConfig(
            strategy=strategy,
            weights=weights or Weights(),
            initialRadiusKm=initial_radius,
            maxRadiusKm=max_radius,
            radiusStepKm=step,
            urgencyHorizonMinutes=360,
            minPickupFeasibilityMinutes=30,
        ),
        now=now,
    )


# Standard recipient set mirroring the backend demo seed.
def standard_recipients():
    return [
        make_recipient("rec-hope", 12.98, 77.60, capacity=100, assigned=40, prefs=("cooked_meals", "packaged")),
        make_recipient("rec-sunrise", 12.95, 77.58, capacity=60, assigned=20, prefs=("cooked_meals", "packaged")),
        make_recipient("rec-green", 12.99, 77.62, capacity=60, assigned=30, prefs=("cooked_meals",)),
        make_recipient("rec-care", 13.20, 77.70, capacity=200, assigned=50, radius=40, prefs=("cooked_meals", "packaged")),
        make_recipient("rec-angels", 12.972, 77.595, capacity=10, assigned=8, prefs=("cooked_meals",)),
        make_recipient("rec-foodbank", 12.96, 77.59, capacity=150, assigned=30, prefs=("packaged",), active=False),
    ]
