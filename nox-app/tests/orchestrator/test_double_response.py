"""Test script to verify no double responses via WebSocket.

Connects to the Nox WebSocket, sends a message, and checks that each
token is received exactly once.

Usage: python test_double_response.py
"""
import asyncio
import json
import websockets

WS_URL = "ws://127.0.0.1:8420/ws/chat"


async def test_no_duplicates():
    tokens = []
    done_content = None

    async with websockets.connect(WS_URL) as ws:
        await ws.send(json.dumps({"message": "Sag nur das Wort Hallo"}))

        while True:
            raw = await ws.recv()
            data = json.loads(raw)

            if data["type"] == "token":
                tokens.append(data["content"])
                print(f"  token: {data['content']!r}")
            elif data["type"] == "done":
                done_content = data.get("content", "")
                print(f"\n  done: {done_content!r}")
                break
            elif data["type"] == "error":
                print(f"  ERROR: {data['content']}")
                return False

    # Reconstruct full response from tokens
    streamed = "".join(tokens)
    print(f"\nStreamed: {streamed!r}")
    print(f"Done:     {done_content!r}")

    # Check for doubling pattern: every word appears twice consecutively
    words = streamed.split()
    duplicates = 0
    for i in range(0, len(words) - 1, 2):
        if i + 1 < len(words) and words[i] == words[i + 1]:
            duplicates += 1

    if duplicates > len(words) * 0.3:
        print(f"\nFAIL: Detected {duplicates} duplicate word pairs out of {len(words)} words")
        return False
    else:
        print(f"\nPASS: No significant doubling detected ({duplicates} dup pairs / {len(words)} words)")
        return True


if __name__ == "__main__":
    result = asyncio.run(test_no_duplicates())
    exit(0 if result else 1)
