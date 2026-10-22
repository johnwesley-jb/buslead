# Vapi setup

Goal: callers talk to your Vapi assistant; Vapi calls **your PC** (through a tunnel) in two situations:

1. **During the call:** the assistant uses two tools, `check_availability` and `book_appointment`, answered by `POST /api/webhooks/vapi`.
2. **After the call:** Vapi sends an `end-of-call-report` (transcript, recording link) to the same URL.

Dashboard labels change over time; where a name below differs from what you see, look for the closest equivalent. Items marked
**(verify)** are things I could not confirm from Vapi's public documentation.

## 1. Start the tunnel

```
ngrok http 4000
```

Copy the `https://….ngrok-free.app` address into `PUBLIC_API_URL` in `.env` and restart the API.
Do **not** enable host-header rewriting. The API only serves `/api/webhooks/*` and `/health` on that public hostname;
everything else (login, dashboard API) answers 404 there.
The free ngrok address changes on restart, so update `PUBLIC_API_URL` and the Vapi Server URL together (a reserved domain avoids this).

Your server URL is: `https://<tunnel-host>/api/webhooks/vapi`

## 2. Create the Bearer credential

Vapi authenticates to your server with a credential you create once:

1. Vapi dashboard → **Credentials / Provider keys → Custom credentials** (name may vary) → **Create → Bearer token**.
2. Token: the exact value of `VAPI_WEBHOOK_SECRET` from your `.env`. Header name `Authorization` (Vapi sends `Authorization: Bearer <token>`).
3. Save and note the credential's name/ID.

The API compares this value in constant time and answers `401` to anything else. (The legacy `X-Vapi-Secret` header also works.)

## 3. Create the two tools

Create two **Function** tools (Tools → Create). Both use the **same server URL and credential**.

**check_availability**

```json
{
  "type": "function",
  "function": {
    "name": "check_availability",
    "description": "Look up open appointment times. Call this whenever the caller asks about a day or time, BEFORE offering or booking it. Never invent availability.",
    "parameters": {
      "type": "object",
      "properties": {
        "date": { "type": "string", "description": "Calendar date in YYYY-MM-DD, resolved from the caller's words using today's date." },
        "time": { "type": "string", "description": "Optional. 24-hour HH:mm in the business time zone, e.g. 14:30, if the caller asked for a specific time." }
      },
      "required": ["date"]
    }
  },
  "server": { "url": "https://<tunnel-host>/api/webhooks/vapi" }
}
```

**book_appointment**

```json
{
  "type": "function",
  "function": {
    "name": "book_appointment",
    "description": "Save the caller's details and book the follow-up. Call it only after the caller has confirmed their details and the exact time. Call it again with a different time if it says the time is unavailable.",
    "parameters": {
      "type": "object",
      "properties": {
        "fullName": { "type": "string", "description": "Caller's full name." },
        "email": { "type": "string", "description": "Email address, spelled back and confirmed by the caller." },
        "phoneNumber": { "type": "string", "description": "Callback number. Optional if the caller ID is acceptable." },
        "reasonForCall": { "type": "string", "description": "One or two sentences on why they are calling." },
        "notes": { "type": "string", "description": "Optional extra details the caller shared." },
        "date": { "type": "string", "description": "YYYY-MM-DD" },
        "time": { "type": "string", "description": "24-hour HH:mm in the business time zone" }
      },
      "required": ["fullName", "email", "reasonForCall", "date", "time"]
    }
  },
  "server": { "url": "https://<tunnel-host>/api/webhooks/vapi" }
}
```

In the dashboard, attach the credential from step 2 to each tool's server settings (**verify**: via `server.credentialId` in the API). The tools return one
JSON string (`status`, a plain-English `message`, and times). The server always answers HTTP 200; Vapi ignores other status codes.

## 4. Configure the assistant

* **Server URL:** the URL from step 1, with the Bearer credential attached.
* **Server messages** (Advanced → Messaging; **verify** the exact label): enable **`end-of-call-report`** and **`tool-calls`**. Others may stay off; the API ignores them.
* **Tools:** add `check_availability` and `book_appointment`.
* **Recording:** make sure call recording is enabled for the assistant (artifact plan, **verify**), or there will be no audio in the dashboard.
* **Voicemail / background settings:** your preference.
* **Optional structured output** (Assistants → Structured outputs): schema with `fullName`, `email`, `phoneNumber`, `reasonForCall`, `preferredDate`, `preferredTime`. The backend uses it as a fallback; the tool arguments already capture the same data, so you can skip it.

### System prompt (edit the business details and time zone)

```text
You are the virtual receptionist for Northline Services. Be warm, brief, and natural. One question at a time.
Today is {{"now" | date: "%A, %B %d, %Y, %I:%M %p", "America/New_York"}} (America/New_York). Use this to turn "tomorrow" or "next Tuesday" into a YYYY-MM-DD date.

Goal: collect the caller's details and book a follow-up with the team.

1. Greet the caller and ask for their full name.
2. Ask for the best email. Spell it back letter by letter and get a clear yes.
3. Confirm the callback number. If they are calling from the number on file, ask "Is this number okay for a callback?" Only ask for another number if not.
4. Ask what the call is about, in a sentence or two.
5. Ask when they would like the follow-up. Call check_availability for that day (and time if they gave one).
   - Offer at most three times, read in the business time zone. Never state a time that check_availability did not return.
   - If the day is closed or full, offer the next available times from the result.
6. Read back name, email, reason and the chosen time. When the caller says yes, call book_appointment.
7. If book_appointment says the time is unavailable, apologize briefly, offer the nearest times it returned, and call it again with the new choice.
8. If it says the details were saved but scheduling is unavailable, say the team will call back to schedule. Do not promise a time.
9. Confirm the booked time, ask if there is anything else, thank them, and end the call.

Rules: never invent availability, prices, or promises. Do not collect payment or sensitive data. If the caller asks for a person or has an emergency, say the team will follow up and still capture their name and number.
```

`{{"now" | date: ...}}` is Vapi's dynamic-variable syntax for the current time **(verify** in the Vapi docs for your account**)**. If it does not render, hard-code the instruction "Ask the caller for the date and convert it to YYYY-MM-DD" or pass the date through your own variable.

## 5. Attach the phone number

Phone Numbers → your number → **Inbound assistant → select the assistant**. Call it.

## 6. Verify end to end

1. Start API + worker, start the tunnel.
2. `curl -i https://<tunnel-host>/api/webhooks/vapi -X POST -d "{}"` must return **401** (no secret). `curl https://<tunnel-host>/api/auth/login` must return **404**.
3. Locally, `npm run simulate -- availability <weekday date>` should answer with open times (needs Google connected).
4. Place a real call. Expected in the API log: a `tool-calls` request per tool, then an `end-of-call-report`. In the dashboard: a new lead, the call with transcript, the appointment, and an event in Google Calendar. The recording can take a few minutes; **Check again** on the call asks Vapi for it.
5. Hang up mid-call on a second call: the lead appears with *Caller hung up before choosing a time*, and (if `AUTO_ASSIGN_UNBOOKED=true`) the worker books the earliest slot within a few minutes.

## What the backend assumes about Vapi payloads

Confirmed in Vapi's documentation: every webhook body is `{ "message": { "type", "call", … } }`; `end-of-call-report` carries
`endedReason` and an `artifact` with `recording`, `transcript` and `messages`; `tool-calls` carries `toolCallList[{ id, function: { name, arguments } }]`
and expects `{ "results": [{ "toolCallId", "result": "<string>" }] }` with HTTP 200.

Read defensively because I could not confirm them for every account: `startedAt` / `endedAt` / `durationSeconds` at the message level, `customer.number` on the call, the exact location of the recording URL
(`artifact.recordingUrl`, `artifact.recording.mono.combinedUrl`, `artifact.recording.stereoUrl`, message-level fallbacks), per-message timestamps (`secondsFromStart` or epoch `time`; without them transcript timing is estimated), and structured-output placement (`artifact.structuredOutputs[id].result`, `analysis.structuredData`).
If a field is missing the call is still stored; to see what your account actually sends, open the failing event's stored payload in the `WebhookEvent` table (Prisma Studio: `npm run db:studio`) — it is purged after 30 days.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Assistant says it could not check availability | Tool credential not attached, wrong URL, tunnel down, or Google not connected (`scheduling_unavailable`). Check the API log. |
| Vapi dashboard shows 401 from your server | The Bearer token differs from `VAPI_WEBHOOK_SECRET` (watch for trailing spaces). |
| Call appears with no transcript | `end-of-call-report` server message not enabled, or the event failed; see the Attention list and `WebhookEvent.error`. |
| Duplicate appointments | Should be impossible (unique event key + overlap constraint). If seen, capture the activity log of both and report it. |
| Times are off by hours | `timeZone` in Scheduling settings differs from the zone in the system prompt. |
