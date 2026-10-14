"""FoodBridge matching service — standalone FastAPI app (spec §9).

    uvicorn app:app --port 8000

Endpoints:
    GET  /health      -> liveness
    POST /match/run   -> one matching cycle (greedy default, hungarian optional)

The engine is independently testable: it takes all state as JSON input and
returns assignments/waitlist/explanations. Persistence stays in the Node
backend; this service is a pure function over its input.
"""

from fastapi import FastAPI

from greedy import greedy_match
from hungarian import hungarian_match
from models import MatchRequest, MatchResponse

app = FastAPI(title="FoodBridge Matching Service", version="0.2.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "foodbridge-matching", "strategies": ["greedy", "hungarian"]}


@app.post("/match/run", response_model=MatchResponse)
def run(request: MatchRequest) -> MatchResponse:
    if request.config.strategy == "hungarian":
        return hungarian_match(request)
    return greedy_match(request)
