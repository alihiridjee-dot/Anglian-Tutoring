from __future__ import annotations
"""
Channel trust. Built from the channels that actually turned up in the harvest,
not from memory — a curated list of names invented up front would mostly be
channels that do not exist.

Three tiers, because "high quality" is not one thing here:
  SPEC  teaches the UK GCSE/A-level specifications directly. Best possible fit.
  ED    excellent science teaching, spec-agnostic (Khan Academy, Amoeba
        Sisters, Professor Dave). Correct and clear, but pitched at its own
        syllabus, so it wins only when nothing spec-aligned matches.
  UNI   university/medical-school level (Ninja Nerd, Osmosis, Armando
        Hasudungan). Accurate and often superb, but way over a GCSE student's
        head — carried at a discount, and penalised further at GCSE.
"""

SPEC = {
    "cognito", "freesciencelessons", "miss estruch", "malmesbury education",
    "primrose kitten academy | gcse & a-level revision", "primrose kitten",
    "science sauce", "mr exham biology", "clare biology", "biorach",
    "launchpad learning", "spectransfer a-level biology", "a level biology help",
    "professor snab", "jo phillips a level biology", "study mind", "examqa",
    "stemrevise", "a*demola", "machemguy", "allery chemistry", "eliot rintoul",
    "physics online", "a level physics online", "science shorts", "kayscience",
    "wright science", "mr murray", "siebert science", "holly g",
    "lisa the science tutor", "biology with christine", "laurasdoesbiology",
    "lauradoesbiology", "otterbiotutor", "dr bhavsar biology", "biology with olivia",
    "snapreviseofficial", "snaprevise", "save my exams", "seneca learning",
    "the gcse chemist", "mr salles teaches", "bogobiology", "d biology classroom",
    "mr fitzpatrick chemistry", "chemistrytutor", "the science break",
    "biology practicals and revision biology tutor", "dr anna y-w",
    "the exam formula", "revision monkey", "gcsephysicsninja", "physics ninja",
    "mr s science", "tuition kit", "shaun donnelly", "mr wilkes science",
    "mr smith science", "aqa physics", "my gcse science", "oxnotes",
    # IGCSE (added 6 Oct 2026 from the IGCSE harvest): syllabus-numbered
    # Cambridge IGCSE lessons, and a UK GCSE revision channel.
    "igcse study buddy", "igbiocomplete", "miss wetton - gcse science revision",
}

ED = {
    "amoeba sisters", "khan academy", "khanacademymedicine", "professor dave explains",
    "ted-ed", "crashcourse", "fuseschool - global education", "fuseschool",
    "bozeman science", "the organic chemistry tutor", "nucleus biology", "yourgenome",
    "ricochetscience", "alila medical media", "science abc", "neural academy",
    "2 minute classroom", "moomoomath and science", "bioman biology",
    "interactive biology", "free animated education", "stephanie castle",
    "animated biology with arpan", "biologyexams4u", "quick biochemistry basics",
    "neuroscientifically challenged", "nucleus medical media", "sci show",
    "scishow", "veritasium", "minutephysics", "the animated teacher",
    "physics girl", "steve mould", "flipping physics", "michel van biezen",
    "tyler dewitt", "melissa maribel", "chemistnate", "socratica",
    "the amoeba sisters", "beverly biology", "henrik's lab", "science with hazel",
    # IGCSE harvest: sound but older or broader IGCSE/O level revision.
    "cambridge in 5 minutes", "pla academy: igcse and a level buddy", "vt.physics",
}

UNI = {
    "ninja nerd", "osmosis from elsevier", "armando hasudungan",
    "medicosis perfectionalis", "dr matt & dr mike", "zero to finals",
    "dr.g bhanu prakash animated medical videos", "oxford mastering biology 牛津基礎生物學",
    "lecturio medical", "kenhub - learn human anatomy", "handwritten tutorials",
}

WEIGHT = {"spec": 1.0, "ed": 0.68, "uni": 0.42, "unknown": 0.3}


def tier(channel: str) -> str:
    c = (channel or "").strip().lower()
    if c in SPEC:
        return "spec"
    if c in ED:
        return "ed"
    if c in UNI:
        return "uni"
    return "unknown"


def weight(channel: str) -> float:
    return WEIGHT[tier(channel)]
