import os
import asyncio
from llm.client import GROQ_API_KEY
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage

async def main():
    chat = ChatGroq(
        model="openai/gpt-oss-120b",
        groq_api_key=os.environ.get("GROQ_API") or GROQ_API_KEY,
        max_tokens=2500,
    )
    print("Sending request...")
    res = await chat.ainvoke([HumanMessage(content="Write a very long 2000 word essay about the history of artificial intelligence.")])
    print(f"Response length in chars: {len(res.content)}")
    print(f"Ends with: {res.content[-100:]}")

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv("../.env")
    asyncio.run(main())
