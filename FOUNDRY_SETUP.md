# Microsoft Foundry Local edition on an Intel Mac

Microsoft Foundry Local does not publish a native Intel macOS runtime. This project
runs the supported Linux x64 Foundry Local Python SDK inside Docker Desktop while
keeping the interface, documents, SQLite database, embeddings, prompts, and models
on this computer.

## One-time setup

1. Install Docker Desktop for Mac with Intel chip from:
   <https://docs.docker.com/desktop/setup/install/mac-install/>
2. Open Docker Desktop and wait until it says the engine is running.
3. Open `/Users/Zahra/local-rag-intel` in Visual Studio Code.
4. Open **Terminal > New Terminal**.
5. Build and start the Foundry edition:

```bash
docker compose -f compose.foundry.yaml up --build
```

The first run installs the SDK and downloads the Foundry embedding and chat models.
Leave the terminal open. When startup completes, open:

<http://127.0.0.1:8001>

Select **Update knowledge base** to create the Foundry-backed SQLite index, then ask
questions in the browser.

## Later starts

```bash
cd /Users/Zahra/local-rag-intel
docker compose -f compose.foundry.yaml up
```

The models are retained in the `foundry-models` Docker volume. The Foundry SQLite
index is retained as `data/foundry_rag.sqlite3`.

## Stop the application

Press **Control+C** in the terminal, then run:

```bash
docker compose -f compose.foundry.yaml down
```

This stops the container without deleting the downloaded models or database.

## Verify Foundry directly

In a second VS Code terminal while the container is running:

```bash
docker compose -f compose.foundry.yaml exec foundry-rag python foundry_main.py doctor
```

The expected final message is `Foundry Local is ready for offline use.`

## Important project statement

The RAG application's primary AI runtime is Microsoft Foundry Local. Docker supplies
the supported Linux x64 environment because the physical development computer uses
an Intel processor and Foundry Local's native macOS package requires Apple silicon.
Ollama remains available only as a native fallback for demonstrations before Docker
is installed.

