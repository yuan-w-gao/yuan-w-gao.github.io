---
layout: page
title: Learning the Rules
description: Neuro-symbolic exploration in interactive worlds
img: assets/img/learning-the-rules/card.png
importance: 1
category: work
# Links for the "Technical details" section. Leave a value empty to hide its button.
report_url:
code_url:
weights_url:
---

{% assign lr = '/assets/learning-the-rules/' | relative_url %}
{% assign lr_data = '/assets/learning-the-rules/data/' | relative_url %}

<link rel="stylesheet" href="{{ lr }}lr.css">

<div class="lr" markdown="1">

<p class="lr-lede">
Can a small language model discover hidden rules as well as a frontier model? I combine <b>symbolic hypothesis search</b>, <b>information-gain experiments</b> and a <b>fine-tuned Qwen3-8B scorer</b>. Together they solve gridworld puzzles they have never seen in far fewer interactions than conventional exploration. On a small matched evaluation, they are competitive with Claude Opus 5.5.
</p>

<div class="lr-hero"
     data-lr-hero
     data-base="{{ lr_data }}"
     data-episode="lamp_gate-0"
     data-agents="search_eig_learned,reflection"
     data-caption="A held-out puzzle. Left: hypothesis search with the fine-tuned 8B scorer. Right: the same 8B model reflecting on its own notes.">
  <noscript><img src="{{ '/assets/img/learning-the-rules/heldout_paired.png' | relative_url }}" alt="Held-out results"></noscript>
</div>

<div class="lr-tiles">
  <div class="lr-tile">
    <div class="lr-tile-label">8B + search vs Claude Opus 5.5, held-out</div>
    <div class="lr-tile-value">30.1 vs 31.3 steps</div>
    <div class="lr-tile-note">15 paired episodes; difference +1.2 [−7.1, +9.3]. Competitive, not a demonstrated tie.</div>
  </div>
  <div class="lr-tile">
    <div class="lr-tile-label">8B + search vs a reflection agent on the same 8B</div>
    <div class="lr-tile-value">37.4 vs 70.2 steps</div>
    <div class="lr-tile-note">50 held-out episodes; 48/50 vs 28/50 solved; difference −32.7 [−42.3, −23.5].</div>
  </div>
  <div class="lr-tile">
    <div class="lr-tile-label">What the fine-tuned scorer adds</div>
    <div class="lr-tile-value">−10.1 steps</div>
    <div class="lr-tile-note">Held-out, vs the same search without it; 95% CI [−17.5, −2.4].</div>
  </div>
</div>

## The puzzle

Each world is a small grid. A door stands between the agent and the goal, and some hidden mechanism opens it. The agent knows the layout and how to move, but not what any object does. A switch might open the door, or light a lamp that the door checks. A plate might open it only once you step *off*. The agent has to work this out by experimenting, and every step counts: there is a budget of 100 steps, and a failure scores 100.

Both the mechanisms and the agent's guesses are written in one small rule language: `WHEN event [IF conditions] THEN effects [AFTER k]`. A hypothesis is a program that can be run, so the agent can check it exactly against everything it has seen. The benchmark has 17 mechanism families. Five of them (lamp gate, box and switch, two keys, second press, leave plate) were written after development finished and used only for the final evaluation.

## Watch the agents

Pick a puzzle, then pick two agents to replay side by side. For the search agents, the panel under each board shows what the agent believes: its most probable door rules, the experiments it considered, and how many hypotheses each step ruled out. Press **Reveal the true rule** to see the answer.

<div class="lr-viewer" data-base="{{ lr_data }}">
  <noscript>The replay viewer needs JavaScript.</noscript>
</div>

Opus beats the 8B agent on some of these puzzles, and on *leave plate* the scorer leads the search astray (55 steps, against 33 without it). The showcase includes both on purpose. The comparison that counts is the average over all paired episodes, shown under Results.

Keyboard: <kbd>space</kbd> plays or pauses, and <kbd>←</kbd> <kbd>→</kbd> step through the replay.

## How it works

<div class="lr-flow">
  <div class="lr-step">
    <div class="lr-step-n">1 · Propose</div>
    <div class="lr-step-title">Enumerate candidate rules</div>
    A symbolic search lists door rules built from triggers, up to two conditions and delays, with up to three rules each.
    <div><span class="lr-step-tag">symbolic</span></div>
  </div>
  <div class="lr-step">
    <div class="lr-step-n">2 · Check</div>
    <div class="lr-step-title">Keep only consistent ones</div>
    Each candidate is replayed on the history so far. Any candidate that mispredicts a single observation is dropped. Up to 300 survivors are kept.
    <div><span class="lr-step-tag">exact</span></div>
  </div>
  <div class="lr-step">
    <div class="lr-step-n">3 · Score</div>
    <div class="lr-step-title">Judge plausibility</div>
    A fine-tuned Qwen3-8B answers "is this the true mechanism?" for each candidate. Its log-odds adjust a prior that favours simple rules.
    <div><span class="lr-step-tag">learned, 8B LoRA</span></div>
  </div>
  <div class="lr-step">
    <div class="lr-step-n">4 · Experiment</div>
    <div class="lr-step-title">Act to tell them apart</div>
    The agent runs the experiment with the most expected information gain per step. Once a plan reaches the goal with probability ≥ 0.5, it takes that plan.
    <div><span class="lr-step-tag">information gain</span></div>
  </div>
</div>
<div class="lr-loop">↺ act, observe, and repeat from step 2 with the new evidence</div>

Why build it this way? The first version asked an LLM (Qwen3-8B, later 32B) to write whole rule sets. On 58 frozen histories it wrote the right door mechanism only 2–4 times. The same plain symbolic search contained the true mechanism in 57 of the 58. Generating ideas was not the bottleneck: **choosing among many consistent candidates was.** That is a job a small model can learn.

The scorer is trained on labels that cost nothing. I took 3,427 snapshots from search episodes on training seeds, and a verifier checked each candidate against the true rules. Validation accuracy rose from 0.29 to 0.97.

## Results

<div class="lr-chart-title">Held-out families: 15 paired episodes</div>
<div class="lr-chart-sub">5 held-out families × 3 seeds, the episodes Claude Opus 5.5 also ran. Every agent played the identical worlds.</div>
<div data-lr-chart="heldout" data-base="{{ lr_data }}">
  <noscript><img src="{{ '/assets/img/learning-the-rules/heldout_paired.png' | relative_url }}" alt="Held-out results, 15 paired episodes"></noscript>
</div>

<div class="lr-callout">
<b>Competitive with Opus, at a small matched scale.</b> Over the 15 paired episodes, Opus minus the 8B search agent is +1.2 steps [−7.1, +9.3], with 8 wins and 7 losses. That interval is wide, and it does not show the two are equivalent. Acting directly, the LLMs gain a lot from scale: 68 steps for Qwen3-8B, 44 for Claude Haiku 5.5 and 31 for Opus. The same 8B model, placed inside hypothesis search, takes 30.
</div>

<div class="lr-chart-title">Across all 17 families</div>
<div class="lr-chart-sub">10 seeds per family; failures count as 100. Whiskers are 95% bootstrap CIs.</div>
<div data-lr-chart="tiers" data-base="{{ lr_data }}">
  <noscript><img src="{{ '/assets/img/learning-the-rules/tiers_grid.png' | relative_url }}" alt="Mean steps by tier"></noscript>
</div>

On the easiest tier every agent does well. The gap opens as mechanisms get harder, and it is widest on the held-out families. There, the search agent with the scorer beats the reflection agent built on the same 8B model by 32.7 steps [−42.3, −23.5] (41 wins, 8 losses). Two ablations, also on held-out families, show what the parts contribute. Keeping many hypotheses with information-gain experiments beats following a single best model by 18.5 steps [−25.1, −12.2], and the learned scorer adds another 10.1 [−17.5, −2.4].

<div class="lr-chart-title">Judging transfers; writing does not</div>
<div class="lr-chart-sub">The same 314 test snapshots (100 held-out). Each model writes the door rules directly in one shot. Opus's training-family score uses 48 of the snapshots.</div>
<div data-lr-chart="proposers" data-base="{{ lr_data }}"></div>

I also trained Qwen3-8B to *write* hypotheses, first with SFT and then with GRPO and a verifier reward. My GRPO is a minimal single-GPU implementation: vLLM sampling with the adapter hot-swapped each step, and group-normalised advantages. Trained on the 12 families alone, the model learns those families, not the grammar: it scores 0% on held-out families. Adding random mechanisms from the grammar gives the first transfer. On held-out families, the best rule writers, fine-tuned 8B and Claude zero-shot alike, are correct only 6–10% of the time, yet consistent with the history 76–99% of the time. GRPO raised consistency but not correctness, because partial credit for consistency was easy to earn. Short histories often can't single out the true mechanism, so consistency is not the same as being right. That is why the agent has to run experiments, and why the post-training result that matters is the scorer, which judges the candidates the search produces.

<div class="lr-chart-title">Cost</div>
<div data-lr-chart="tiles" data-base="{{ lr_data }}"></div>

**A finding about the API:** Claude Opus 5.5 refused the reflection agent's prompts as `reasoning_extraction` whenever the answer format asked it to write out its reasoning. Opus therefore ran *choice-only*, and the invalid run is excluded rather than hidden. A control on Haiku, run both ways, differs by +1.1 [−3.7, +5.9] steps, so dropping the notes doesn't explain the result.

## Limitations

- **Small frontier sample.** Opus ran 15 episodes at a fixed medium effort, and only the choice-only variant.
- **Same grammar.** The held-out mechanisms are new structures, but they come from the same rule grammar the search covers. Mechanisms outside it would need a larger search space.
- **Small, generated worlds.** Absolute step counts don't carry over to other domains. The result is the comparison between agents on identical worlds.

## Technical details

<div class="lr-links">
{% if page.report_url %}<a href="{{ page.report_url }}">Technical report</a>{% endif %}
{% if page.code_url %}<a href="{{ page.code_url }}">Code and benchmark</a>{% endif %}
{% if page.weights_url %}<a href="{{ page.weights_url }}">Model weights (LoRA adapters)</a>{% endif %}
</div>

The benchmark, the agents and the full evaluation (every episode behind these charts) are in the code repository, with the reproduction commands. The fine-tuned components are LoRA adapters (rank 16) on Qwen3-8B, trained on a single A100.

</div>

<script defer src="{{ lr }}viewer.js"></script>
<script defer src="{{ lr }}charts.js"></script>
