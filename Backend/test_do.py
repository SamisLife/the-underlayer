import os
import requests
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("DO_AI_API_KEY")

print("KEY FOUND:", bool(api_key))

url = "https://inference.do-ai.run/v1/chat/completions"

headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {api_key}"
}

payload = {
    "model": "openai-gpt-oss-120b",
    "messages": [
        {
            "role": "user",
            "content": "What is the capital of France?"
        }
    ],
    "max_tokens": 50
}

response = requests.post(
    url,
    headers=headers,
    json=payload
)

print("STATUS:", response.status_code)
print(response.text)