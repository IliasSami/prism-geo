# PrismGEO Capture

A small browser extension that saves the AI answer you are looking at to your own PrismGEO.

You ask a question in your own ChatGPT, Gemini, Perplexity, Copilot or Google account, wait for the full answer, and click the PrismGEO icon. The extension matches the answer to one of your tracked questions (or adds it as a new one), shows you exactly what it will send, and saves it. PrismGEO then checks and scores it like any other answer: cited sources, reused passages, which tracked companies are named, with what tone, and brand look-alikes. It is stored as **captured by hand** (`manual`).

Because a person asks every question, nothing is automated: this route is free and stays within each service's terms. It is the most faithful view of what a signed-in buyer sees, and it suits the questions that matter most (decision-stage, comparisons, questions that name your brand).

## Install (Chrome, Edge, Brave, Arc)

1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and choose this `apps/extension` folder.
3. In PrismGEO open **Settings → Engines & access → Capture by hand** and copy the address and the capture token.
4. Open the extension's settings (right-click the icon → Options, or the **Settings** button in its popup), paste both, and click **Save and test**. It should say "Connected".

To share it with your team as a file: `pnpm extension:zip` writes `dist/prismgeo-capture.zip` (team members load the unzipped folder the same way).

## Use

1. Ask the question in the engine and wait until the answer is complete.
2. In Gemini, open the **Sources** panel first if you want its sources included.
3. Click the PrismGEO icon. Check the client and the tracked question (★ marks a close match), optionally expand **What will be sent**, and click **Save answer**.
4. The popup confirms which tracked companies the answer named.

The extension refuses to save an answer that is still being written, a page without an answer, or the same answer twice. A Google results page without an AI Overview is a real result: there is nothing to save.

## Privacy and permissions

- **activeTab** and **scripting**: the page is read only when you click the icon, and only that tab. There are no background scripts and no content scripts running on your pages.
- **storage**: the PrismGEO address and token, on this computer only.
- **Host access** to `localhost` / `127.0.0.1`, where PrismGEO runs by default. If your PrismGEO runs elsewhere, the extension asks for permission to reach that address when you save it.
- Answers are sent only to your PrismGEO, and only when you click Save. The capture token can only list your questions and save answers; rotate it in Settings at any time.

## Supported pages

| Engine | Pages |
| :--- | :--- |
| ChatGPT | chatgpt.com conversations |
| Gemini | gemini.google.com conversations |
| Perplexity | perplexity.ai answers |
| Copilot | copilot.microsoft.com conversations |
| Google AI Overviews | google.com search results with an AI Overview |

Engines change their pages often. If an answer is not found, please open an issue with the engine and what you saw.
