"""Pydantic models for the FoodBridge matching service HTTP/JSON contract.

The Node backend POSTs a MatchRequest to /match/run and receives a
MatchResponse. Python 3.9 compatible (Optional[...] instead of X | Y).
"""

from datetime import datetime, timezone
from typing import Dict, List, Literal, Optional, Tuple

from pydantic import BaseModel, Field


def parse_iso8601(value: str) -> datetime:
    """Parse ISO-8601 into an aware datetime (Python 3.9: no 'Z' support in
    fromisoformat, naive values assumed UTC)."""
    text = value.strip()
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


class DonationIn(BaseModel):
    donationId: str
    foodType: str
    quantityServings: int = Field(gt=0)
    latitude: float
    longitude: float
    postedAt: Optional[datetime] = None
    expiresAt: datetime
    pickupStart: Optional[datetime] = None
    pickupEnd: Optional[datetime] = None


class RecipientIn(BaseModel):
    recipientId: str
    name: str = ""
    latitude: float
    longitude: float
    servingCapacity: int = Field(ge=0)
    assignedServings: int = 0
    serviceRadiusKm: float = 10.0
    foodPreferences: List[str] = []
    dietaryRestrictions: List[str] = []
    active: bool = True

    @property
    def available_capacity(self) -> float:
        return max(0.0, self.servingCapacity - self.assignedServings)


class Exclusion(BaseModel):
    donationId: str
    recipientId: str


class PairDistance(BaseModel):
    """Precomputed PostGIS ST_Distance for a donation-recipient pair."""
    donationId: str
    recipientId: str
    distanceKm: float


class Weights(BaseModel):
    """Configurable engineering parameters — NOT scientifically optimal
    constants (see docs/MATCHING_ALGORITHM.md)."""
    urgency: float = 0.4
    proximity: float = 0.35
    capacity: float = 0.25


class MatchConfig(BaseModel):
    strategy: Literal["greedy", "hungarian"] = "greedy"
    weights: Weights = Weights()
    initialRadiusKm: float = 5.0
    maxRadiusKm: float = 25.0
    radiusStepKm: float = 5.0
    urgencyHorizonMinutes: float = 360.0
    minPickupFeasibilityMinutes: float = 30.0


class MatchRequest(BaseModel):
    donations: List[DonationIn]
    recipients: List[RecipientIn]
    exclusions: List[Exclusion] = []
    pairDistances: List[PairDistance] = []
    config: MatchConfig = MatchConfig()
    now: datetime


class Assignment(BaseModel):
    donationId: str
    recipientId: str
    totalScore: float
    urgencyScore: float
    proximityScore: float
    capacityScore: float
    distanceKm: float
    searchRadiusKmUsed: float


class Waitlisted(BaseModel):
    donationId: str
    reason: str
    maxRadiusKmTried: float


class CandidateExplanation(BaseModel):
    recipientId: str
    eligible: bool
    reasons: List[str] = []
    totalScore: Optional[float] = None
    proximityScore: Optional[float] = None
    capacityScore: Optional[float] = None
    distanceKm: Optional[float] = None


class DonationExplanation(BaseModel):
    donationId: str
    outcome: Literal["MATCHED", "WAITLISTED"]
    candidates: List[CandidateExplanation]


class MatchResponse(BaseModel):
    strategy: str
    assignments: List[Assignment]
    waitlisted: List[Waitlisted]
    explanations: List[DonationExplanation]


# Convenience type used across the algorithm modules.
ExclusionSet = set  # set[Tuple[str, str]]
PairDistanceMap = Dict[Tuple[str, str], float]
