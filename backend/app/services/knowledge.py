import math
from ..config import get_settings


def _grams(s: str) -> set[str]:
    s = "".join(s.split()).lower()
    return {s[i:i + 2] for i in range(len(s) - 1)}


def _cosine(left: list[float], right: list[float]) -> float:
    if len(left) != len(right):
        return 0.0
    denominator = math.sqrt(sum(value * value for value in left) * sum(value * value for value in right))
    return sum(a * b for a, b in zip(left, right)) / denominator if denominator else 0.0


def _embedding(client, model: str, text: str) -> list[float]:
    response = client.embeddings.create(model=model, input=text)
    return list(response.data[0].embedding)


def _openai_client():
    settings = get_settings()
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is required when OPENAI_EMBEDDING_MODEL is configured")
    from openai import OpenAI
    return OpenAI(api_key=settings.openai_api_key)


def _result(document: dict, score: float) -> dict:
    return {"document": document["source"], "page": document["page"],
            "text": document["text"][:1200], "test_code": document.get("test_code"),
            "item_ids": document.get("item_ids", []), "score": round(score, 4)}


def search(repo, org_id: str, query: str, test_code: str | None = None, k: int = 5,
           embedding_client=None, embedding_model: str | None = None) -> list[dict]:
    settings = get_settings()
    model = settings.openai_embedding_model if embedding_model is None else embedding_model
    if not settings.openai_allow_reference_embedding_upload:
        model = ""
    documents = []
    for doc in repo.list("knowledge_documents", org_id):
        if doc.get("needs_ocr") or doc.get("needs_review") or not doc.get("text"):
            continue
        if test_code and doc.get("test_code") != test_code:
            continue
        documents.append(doc)

    if model:
        client = embedding_client or _openai_client()
        query_embedding = _embedding(client, model, query)
        vector_scores = [(_cosine(query_embedding, d["embedding"]), d)
                         for d in documents if isinstance(d.get("embedding"), list)]
        if vector_scores:
            vector_scores.sort(key=lambda pair: pair[0], reverse=True)
            return [_result(document, score) for score, document in vector_scores[:k]]

    q = _grams(query)
    scored = []
    for d in documents:
        g = _grams(d["text"])
        if q and (s := len(q & g) / len(q)) > 0.2:
            scored.append((s, d))
    scored.sort(key=lambda x: -x[0])
    return [_result(document, score) for score, document in scored[:k]]
