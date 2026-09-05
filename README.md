# Offline RAG with Microsoft Foundry Local

A private, on-device Retrieval-Augmented Generation (RAG) assistant built for an
Intel Mac. Microsoft Foundry Local runs in a supported Linux x64 Docker container,
while the web interface, documents, indexes, conversations, prompts, and models
remain on the local computer.

## Features

- Microsoft Foundry Local for chat generation and document embeddings
- Local SQLite vector search with source citations
- Drag-and-drop `.txt`, `.md`, and `.pdf` document uploads
- Separate conversations with chat history and chat deletion
- Password-protected private chats stored as an encrypted browser vault
- A separate encrypted document collection for each private vault
- No cloud API key required
- Responsive local web interface

## How it works

1. Documents are divided into smaller text chunks.
2. Foundry Local converts the chunks into embeddings.
3. SQLite stores the embeddings and document metadata locally.
4. A question is embedded and matched to the most relevant chunks.
5. Foundry Local generates an answer using only the retrieved context.
6. The interface displays the answer and its source documents.

## Requirements

- macOS on an Intel processor
- Docker Desktop for Mac with Intel chip
- Visual Studio Code (recommended)
- Internet access for the first model download only

## Start the Foundry Local edition

Open this project folder in Visual Studio Code. Select **Terminal > New Terminal**,
then run:

```bash
docker compose -f compose.foundry.yaml up --build
```

When startup finishes, open <http://127.0.0.1:8001>. Select **Update knowledge
base** after adding public documents. Later starts can omit `--build`:

```bash
docker compose -f compose.foundry.yaml up
```

To stop the application, press **Control+C**, then run:

```bash
docker compose -f compose.foundry.yaml down
```

See [FOUNDRY_SETUP.md](FOUNDRY_SETUP.md) for setup details and a direct Foundry
verification command.

## Models

- Chat model: `qwen2.5-0.5b`
- Embedding model: `qwen3-embedding-0.6b`

Both are downloaded and served by Microsoft Foundry Local. The model cache is kept
in a Docker volume so it survives normal restarts.

## Privacy

Normal uploaded documents and generated databases are intentionally excluded from
Git. Private documents are isolated from the public knowledge base and encrypted at
rest with AES-GCM. Private chat history is password-encrypted in the browser. The
application does not upload RAG content to a cloud AI service.

Passwords cannot be recovered. Forgetting a private-chat password means its
encrypted history and private documents cannot be opened.

## Run the tests

While the container is running:

```bash
docker compose -f compose.foundry.yaml exec foundry-rag python -m unittest discover -s tests
```

## Project structure

```text
foundry_main.py           Foundry Local RAG server and pipeline
web/                      Browser interface
tests/                    RAG and private-document tests
compose.foundry.yaml      Intel Mac Docker configuration
Dockerfile.foundry        Foundry Local application image
requirements-foundry.txt  Python dependencies
documents/                Local uploads (not committed)
data/                     Local indexes and vaults (not committed)
```

## Optional Ollama fallback

`main.py` contains the earlier lightweight Ollama edition. It is retained only as a
native fallback; Microsoft Foundry Local is the primary runtime for this project.
