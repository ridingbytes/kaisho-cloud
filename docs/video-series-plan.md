# Kaisho Video Series Plan

Created: 2026-04-23
For: Ramon Bartl, RIDING BYTES GmbH


## The Story

I tried every time tracker out there. Toggl, Clockify, Harvest,
you name it. None of them worked for me, and it wasn't about
data ownership or privacy. The problem was deeper:

**They were just time trackers.** My work doesn't live in a
timer. It lives in tasks, in customer conversations, in notes
I scribble during calls, in budgets I need to monitor. Every
tracker forced me to duplicate data: projects in Toggl AND in
my task manager, customers in Harvest AND in my invoicing tool.
Two sources of truth, always drifting apart.

I forgot to track time because the tracker was in another app,
another tab, another context switch. And when I realized three
hours later that I'd been coding without a running timer, I had
to reconstruct what I did from git commits and calendar entries.
Editing past entries was painful. Some trackers didn't even
allow it.

I live in Emacs and the terminal. No tracker integrated into
that world. I couldn't start a timer from my editor, couldn't
query my hours from a shell script, couldn't edit a clock entry
by opening a text file.

So I built Kaisho. Not a time tracker with extras bolted on,
but a complete work structure: time, tasks, customers,
contracts, budgets, notes, inbox, knowledge base. All
connected. All in plain text files I can edit by hand. All
accessible from the UI, the CLI, Emacs, or an AI assistant
that actually knows what I'm working on.

This video series shows what that looks like in practice.


## Positioning

**Channel:** @ridingbytes (already registered)
**Language:** English (global developer audience, same reasoning
as the SENAITE strategy)

Kaisho videos go on the same channel as SENAITE content. They
serve a different audience (freelancers, solo devs, consultants)
but the cross-pollination is intentional: SENAITE users already
trust Ramon as a technical authority. Kaisho establishes him as
someone who builds the tools he uses.

**Tagline for Kaisho playlist:** "Your work, structured."


## The Wow Effect

The series builds tension across episodes. Each video reveals a
new layer that reframes what the viewer thought the tool was.

- Video 1: "It's a productivity system" (not just a timer)
- Video 2: "Time, tasks, and customers are connected"
- Video 3: "I can do all of this from the terminal"
- Video 4: "The AI knows my tasks and acts on them"
- Video 5: "It syncs to my phone"
- Video 6: "I control it from Emacs and Claude Code"

By video 3, viewers realize this fits into their existing
workflow. By video 4, they see the AI is not a gimmick. By
video 6, developers understand this was built by someone who
thinks like them.


## Playlist: Kaisho in Action (8 videos)

### Video 1: Why I Built My Own Productivity System (6 min)

**Hook:** "I tried every time tracker. None of them worked.
Not because they were bad at tracking time, but because
tracking time was never the actual problem."

**Content:**
- Start with the pain: "I'm a freelance developer. I work
  for multiple clients. I need to know what I'm doing, for
  whom, how long it took, and whether I'm still within
  budget. No single tool gave me that."
- Show the fragmentation: "My tasks were in one app, my
  hours in another, my invoices in a spreadsheet. I was
  duplicating customers, duplicating projects, and still
  forgetting to start the timer."
- Show Kaisho's dashboard: tasks, hours, budgets, all in
  one view. "This is what I needed. Not a timer. A
  structure."
- Start a timer for "Acme Biotech" from the dashboard
- Show the tray icon ticking, the header showing elapsed
  time
- Stop the timer, show it linked to the customer, the
  contract, the budget bar updating
- Open `clocks.org` in a text editor: "And this is where
  it lives. A plain text file. I can read it, edit it,
  grep it, git-version it."

**CTA:** "Download it free. Next video: how customers,
budgets, and tasks actually connect."

**Lead-gen:** Free download, GitHub stars

**Production notes:**
- Screen recording at 2x resolution (Retina)
- Use the light theme for clarity
- No facecam for this one -- pure product demo
- Background music: lo-fi, low volume


### Video 2: Customers, Budgets, and Time (6 min)

**Hook:** "Three hours into a project, I check the budget.
It's at 85%. I would have missed this in a spreadsheet."

**Content:**
- Open customers view, show 4-5 fictional customers
- Create a new customer, add a contract with a monthly
  budget (e.g. 40 hours)
- Book time entries against that customer
- Switch to dashboard: the budget bar turns from green to
  orange. Click it to drill down into the entries that
  consumed the budget.
- Show invoice export (CSV/Excel): "End of the month, one
  click."
- Key point: "Every number you see is clickable. It always
  shows you where it comes from. I built this because I
  was tired of trusting aggregated numbers I couldn't
  verify."
- Show editing a past entry: change the customer, adjust
  the hours, add notes. "I forgot to track yesterday
  afternoon. I just add it now, backdate it, done."

**CTA:** "If you freelance or consult, this replaces the
spreadsheet, the invoicing tool, and half your project
manager."

**Lead-gen:** Free download


### Video 3: The Task Board and the Inbox (6 min)

**Hook:** "Where do you put the thing your client just told
you on a call? I type it into my inbox and sort it out
later."

**Content:**
- Show the inbox: quick capture. Type "Fix login bug for
  Acme", press Enter. It's captured with a timestamp and
  auto-detected type.
- Show promoting an inbox item to a task: one click, it
  moves to the kanban board.
- Show the kanban board: columns (TODO, IN_PROGRESS,
  REVIEW, DONE), drag-and-drop, customer color coding.
- Start a timer directly from a task card (the play
  button): "The clock entry is now linked to this task.
  When I invoice Acme, I can see exactly which tasks the
  hours went to."
- Show notes: "Meeting notes, client requirements, ideas.
  They live here, tagged by customer."
- Key point: "Inbox, tasks, notes, time. Four things that
  were in four apps. Now they're connected and I capture
  without deciding upfront what something is."

**CTA:** "Tasks, time, and customers, all connected. No
copy-paste between apps."


### Video 4: The CLI (5 min)

**Hook:** "Everything I just showed you in the UI? I can do
it from the terminal in one line."

**Content:**
- `kai clock start "Acme Biotech" "API refactoring"`
- `kai clock status` (show running timer)
- `kai clock stop`
- `kai task list --customer "Acme Biotech"`
- `kai task add "Acme Biotech" "Fix login bug"`
- `kai clock list --week` (show weekly summary)
- Show the command bar in the UI (Cmd+J): "Same commands,
  inside the app."
- `kai ask "How many hours did I bill Acme this month?"`
  (first glimpse of the AI)
- Key point: "I forgot to start the timer three hours ago.
  I'm in the terminal. `kai clock book 3h Acme 'API work'`
  Done. No tab switching, no UI, no friction."

**CTA:** "CLI-first means scriptable. Cron jobs, shell
aliases, editor keybindings. Your workflow, your rules."


### Video 5: The AI Advisor (7 min)

**Hook:** "What if your productivity tool could answer
questions about your work? Not generic answers. Answers
based on your actual tasks, your actual hours, your actual
customers."

**Content:**
- Open the advisor panel
- Ask: "What should I focus on today?" -- show it reading
  open tasks, recent clock entries, and inbox items, then
  giving a prioritized answer
- Ask: "How many hours did I bill this month?" -- show the
  tool call happening in real time (the advisor calls
  list_clock_entries, aggregates, responds)
- Ask: "Create a task for NovaChem: review the test
  results" -- show it calling the create_task tool, the
  task appearing on the board
- Ask: "Start a clock for Acme, working on the API" --
  show the timer starting from a chat message
- Show the model selector: Ollama (local, free), Claude,
  OpenAI, OpenRouter. "Your model, your choice. Data stays
  local unless you choose otherwise."
- Show a cron job: "I have a daily briefing that runs
  every morning at 8am. It reads my tasks, my calendar,
  and my inbox, and writes a summary."

**CTA:** "41 tools. The AI sees your tasks, your hours,
your customers, and acts on them. Not a chatbot. A
colleague."

**This is the peak wow moment.** The viewer sees the LLM
calling real tools against real data.


### Video 6: Mobile Sync and the PWA (5 min)

**Hook:** "I'm at a client site. I pull out my phone, start
a timer. When I get back to my desk, it's already there."

**Content:**
- Show the PWA on a phone (screen recording or simulator)
- Start a timer on mobile
- Switch to the desktop app: the timer is synced
- Stop the timer on desktop
- Show entries synced back on mobile
- Walk through the mobile advisor: "Same AI, same tools,
  on my phone."
- Show the pricing: free (local only), EUR 9/mo (cloud
  sync), EUR 19/mo (sync + AI)
- Key point: "The sync is bidirectional. Your local org
  file is always the source of truth. The cloud is a
  transport layer, not a prison."

**CTA:** "Try it free, sync when you need it."

**Lead-gen:** Cloud Sync subscription


### Video 7: Emacs, MCP, and Claude Code (6 min)

**Hook:** "I spend most of my day in Emacs. Switching to a
browser to start a timer was the reason I kept forgetting.
So I stopped switching."

**Content:**
- Show kaisho-mode in Emacs: `C-c k t` to toggle timer
- Show the mode-line: clock ticking, customer name visible
- Show clocks.org, todos.org in Emacs: standard org-mode
  files, editable by hand
- "I see a wrong time entry? I open the file, fix the
  CLOCK line, save. No API, no form, no undo button that
  doesn't work."
- Switch to Claude Code: "What tasks do I have open for
  Acme?" -- MCP tools called behind the scenes
- Switch to gptel in Emacs: same question, same tools,
  inside Emacs
- Key point: "40 tools, accessible from any AI client that
  speaks MCP. Your editor is your cockpit. Kaisho is just
  there."

**CTA:** "If you live in the terminal, this was built for
you."

**This video targets the developer audience specifically.**


### Video 8: Plain Text and Data Freedom (4 min)

**Hook:** "Let me show you something. This is my entire
productivity system."

**Content:**
- Open a terminal, show the profile directory
- Show the org files: `todos.org`, `clocks.org`,
  `notes.org`, `inbox.org`, `customers.org`
- Open `clocks.org` in Emacs: show the CLOCK logbook
  format, the properties, the notes
- Open `todos.org`: show TODO headings with tags and state
  history
- "These are standard org-mode files. Emacs reads them.
  Vim reads them. grep searches them. git versions them.
  I've been using org-mode for years. Kaisho just gives it
  a UI, a CLI, and an AI."
- Show `kai convert --from org --to markdown`: "Want
  Markdown instead? One command."
- "If I stop using Kaisho tomorrow, my data is still
  there. No export wizard, no JSON dump, no waiting for a
  GDPR request. It's text files on my disk."
- End with: "Every tool I tried before this made me feel
  like my data was a guest in someone else's house. I
  wanted it to live in mine."

**CTA:** "Download Kaisho. Own your work."

**This is the closing argument.** After 7 videos of
features, this one grounds everything in the philosophy.


## Production Setup

Reuse the SENAITE production setup from YOUTUBE-STRATEGIE.md:

- **Recording:** OBS or ScreenFlow, 1920x1080 @ 60fps
- **Audio:** USB condenser mic, noise gate, compressor
- **Editing:** DaVinci Resolve (free)
- **Thumbnails:** Figma or Canva, consistent Kaisho brand
  colors (Graphite Lavender palette: #18181b primary)
- **Music:** Epidemic Sound or royalty-free lo-fi

**Demo profile:** Use the `demo-screenshots` profile with
fictional customers (Acme Biotech, NovaChem Labs,
GreenField Research, EuroLab AG). Never show real client
data.


## Thumbnail Design

Consistent template across all 8 videos:

- Left side: screenshot of the relevant Kaisho view
- Right side: bold text (2-3 words max)
- Bottom: Kaisho logo + episode number
- Color: dark background (#18181b), white text, teal
  accent (#14b8a6) for highlights

Examples:
- Video 1: Dashboard screenshot + "YOUR WORK, STRUCTURED"
- Video 3: Inbox + kanban screenshot + "CAPTURE EVERYTHING"
- Video 5: Advisor screenshot + "AI THAT ACTS"
- Video 7: Emacs split-screen + "EDITOR-FIRST"
- Video 8: org-mode file + "PLAIN TEXT"


## Release Schedule

One video per week. Publish on Tuesday at 14:00 UTC
(optimal for global developer audience based on vidIQ
data for dev tooling channels).

| Week | Video | Title |
|------|-------|-------|
| 1 | 1 | Why I Built My Own Productivity System |
| 2 | 2 | Customers, Budgets, and Time |
| 3 | 3 | The Task Board and the Inbox |
| 4 | 4 | The CLI |
| 5 | 5 | The AI Advisor |
| 6 | 6 | Mobile Sync and the PWA |
| 7 | 7 | Emacs, MCP, and Claude Code |
| 8 | 8 | Plain Text and Data Freedom |


## Cross-Promotion

- Each video description links to kaisho.dev, GitHub repo,
  docs.kaisho.dev
- Video 6 links to cloud.kaisho.dev for sync signup
- Pin a comment on Video 1 linking to the full playlist
- Post each video to:
  - X/Twitter (@ridingbytes)
  - Hacker News (Video 1, Video 5, Video 8 -- the three
    with strongest HN appeal)
  - Reddit: r/productivity, r/emacs, r/commandline,
    r/selfhosted
  - Emacs-specific communities for Video 7
  - LinkedIn for Videos 2 and 3 (freelancer audience)


## Metrics to Track

- Views per video (target: 500+ in first month)
- Click-through to kaisho.dev (UTM links in description)
- GitHub stars growth correlated to video release dates
- Cloud sync signups from Video 6 onward
- YouTube subscriber growth (target: 200+ from the series)


## Future Videos (after the 8-part series)

- "Kaisho vs Toggl vs Clockify" (comparison, SEO play)
- "How I Track 5 Clients with One Tool" (workflow video)
- "Building a Cron Job That Writes My Daily Briefing"
  (advanced AI use case)
- "Kaisho + Obsidian: Markdown Backend Deep Dive"
- "Contributing to Kaisho: Your First PR"
- Live coding sessions: building new features in public
