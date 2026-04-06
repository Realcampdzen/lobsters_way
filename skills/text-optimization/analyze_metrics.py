#!/usr/bin/env python3
"""
Cross-platform text metrics analyzer for Russian long-form drafts.

Usage:
  python3 skills/text-optimization/analyze_metrics.py path/to/file.md
  cat text.md | python3 skills/text-optimization/analyze_metrics.py
  python3 skills/text-optimization/analyze_metrics.py --json < text.md
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple


MIN_FLESCH_RU = 55
MAX_AVG_SENTENCE = 18
MAX_WATER_PERCENTAGE = 15
MAX_PASSIVE_PERCENTAGE = 10
MIN_LEXICAL_DIVERSITY = 0.42

PASS_EXIT_CODE = 0
FAIL_EXIT_CODE = 1
INPUT_ERROR_EXIT_CODE = 2


@dataclass
class AnalysisResult:
    source: str
    flesch_ru: float
    avg_sentence_length: float
    water_percentage: float
    passive_voice_percentage: float
    lexical_diversity: float
    repetitions_4gram: int
    total_sentences: int
    total_words: int
    repetitions_sample: List[Tuple[str, int]]
    meets_criteria: Dict[str, bool]

    @property
    def passed_checks(self) -> int:
        return sum(1 for value in self.meets_criteria.values() if value)

    @property
    def total_checks(self) -> int:
        return len(self.meets_criteria)

    @property
    def all_checks_passed(self) -> bool:
        return self.passed_checks == self.total_checks

    def to_dict(self) -> Dict[str, object]:
        return {
            "source": self.source,
            "flesch_ru": self.flesch_ru,
            "avg_sentence_length": self.avg_sentence_length,
            "water_percentage": self.water_percentage,
            "passive_voice_percentage": self.passive_voice_percentage,
            "lexical_diversity": self.lexical_diversity,
            "repetitions_4gram": self.repetitions_4gram,
            "total_sentences": self.total_sentences,
            "total_words": self.total_words,
            "repetitions_sample": self.repetitions_sample,
            "meets_criteria": self.meets_criteria,
            "passed_checks": self.passed_checks,
            "total_checks": self.total_checks,
            "all_checks_passed": self.all_checks_passed,
        }


class TextAnalyzer:
    def __init__(self, text: str) -> None:
        self.text = text
        self.sentences = self._split_sentences(text)
        self.words = self._tokenize(text)

    def _split_sentences(self, text: str) -> List[str]:
        sentences = re.split(r"[.!?]+(?:\s+|$)", text)
        return [sentence.strip() for sentence in sentences if sentence.strip()]

    def _tokenize(self, text: str) -> List[str]:
        return re.findall(r"\b[а-яА-ЯёЁa-zA-Z]+\b", text.lower())

    def _count_syllables(self, word: str) -> int:
        vowels = "аеёиоуыэюяaeiouy"
        return sum(1 for char in word.lower() if char in vowels)

    def flesch_reading_ease_ru(self) -> float:
        if not self.sentences or not self.words:
            return 0.0

        avg_sentence_length = len(self.words) / len(self.sentences)
        avg_syllables_per_word = sum(self._count_syllables(word) for word in self.words) / len(
            self.words
        )
        fre_ru = 206.835 - 1.52 * avg_sentence_length - 65.14 * avg_syllables_per_word
        return round(fre_ru, 1)

    def avg_sentence_length(self) -> float:
        if not self.sentences:
            return 0.0
        total_words = sum(len(self._tokenize(sentence)) for sentence in self.sentences)
        return round(total_words / len(self.sentences), 1)

    def water_percentage(self) -> float:
        water_words = {
            "очень",
            "действительно",
            "конечно",
            "вообще",
            "наверное",
            "возможно",
            "кажется",
            "видимо",
            "просто",
            "именно",
            "что",
            "как",
            "где",
            "когда",
            "если",
            "чтобы",
            "потому",
            "поэтому",
            "однако",
            "также",
            "тоже",
            "даже",
            "лишь",
        }
        if not self.words:
            return 0.0
        water_count = sum(1 for word in self.words if word in water_words)
        return round((water_count / len(self.words)) * 100, 1)

    def passive_voice_percentage(self) -> float:
        if not self.sentences:
            return 0.0
        passive_markers = (
            r"\b(был[аио]?|будет|будут|является|являются|считается|считаются|"
            r"называется|используется|применяется)\b"
        )
        passive_count = len(re.findall(passive_markers, self.text, re.IGNORECASE))
        return round((passive_count / len(self.sentences)) * 100, 1)

    def find_repetitions(self, n: int = 4, min_count: int = 3) -> List[Tuple[str, int]]:
        if len(self.words) < n:
            return []
        ngrams: List[str] = []
        for index in range(len(self.words) - n + 1):
            ngram = " ".join(self.words[index : index + n])
            ngrams.append(ngram)
        counts = Counter(ngrams)
        return sorted(
            [(ngram, count) for ngram, count in counts.items() if count >= min_count],
            key=lambda item: (-item[1], item[0]),
        )

    def lexical_diversity(self) -> float:
        if not self.words:
            return 0.0
        return round(len(set(self.words)) / len(self.words), 3)

    def analyze(self, source: str) -> AnalysisResult:
        repetitions = self.find_repetitions(4)
        flesch_ru = self.flesch_reading_ease_ru()
        avg_sentence_length = self.avg_sentence_length()
        water_percentage = self.water_percentage()
        passive_voice_percentage = self.passive_voice_percentage()
        lexical_diversity = self.lexical_diversity()

        meets_criteria = {
            "flesch_ru": flesch_ru >= MIN_FLESCH_RU,
            "sentence_length": avg_sentence_length <= MAX_AVG_SENTENCE,
            "water": water_percentage <= MAX_WATER_PERCENTAGE,
            "passive_voice": passive_voice_percentage <= MAX_PASSIVE_PERCENTAGE,
            "repetitions": len(repetitions) == 0,
            "lexical_diversity": lexical_diversity > MIN_LEXICAL_DIVERSITY,
        }

        return AnalysisResult(
            source=source,
            flesch_ru=flesch_ru,
            avg_sentence_length=avg_sentence_length,
            water_percentage=water_percentage,
            passive_voice_percentage=passive_voice_percentage,
            lexical_diversity=lexical_diversity,
            repetitions_4gram=len(repetitions),
            total_sentences=len(self.sentences),
            total_words=len(self.words),
            repetitions_sample=repetitions[:5],
            meets_criteria=meets_criteria,
        )


def read_input(source: str | None) -> Tuple[str, str]:
    if source:
        file_path = Path(source)
        if not file_path.exists():
            raise FileNotFoundError(f"Input file not found: {source}")
        return file_path.read_text(encoding="utf-8"), str(file_path)

    if sys.stdin.isatty():
        raise ValueError("No input provided. Pass a file path or pipe text via stdin.")

    return sys.stdin.read(), "<stdin>"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Analyze readability metrics for a Russian text draft."
    )
    parser.add_argument("source", nargs="?", help="Path to a UTF-8 text file. If omitted, stdin is used.")
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print machine-readable JSON instead of a text report.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Return non-zero exit code when any target metric is missed.",
    )
    return parser


def format_text_report(result: AnalysisResult) -> str:
    lines = [
        f"Analysis source: {result.source}",
        "",
        "Core metrics:",
        f"- Flesch-RU: {result.flesch_ru} (target >= {MIN_FLESCH_RU})",
        f"- Avg sentence length: {result.avg_sentence_length} words (target <= {MAX_AVG_SENTENCE})",
        f"- Water percentage: {result.water_percentage}% (target <= {MAX_WATER_PERCENTAGE}%)",
        f"- Passive voice: {result.passive_voice_percentage}% (target <= {MAX_PASSIVE_PERCENTAGE}%)",
        f"- Lexical diversity: {result.lexical_diversity} (target > {MIN_LEXICAL_DIVERSITY})",
        f"- Repeated 4-grams: {result.repetitions_4gram} (target = 0)",
        "",
        "Stats:",
        f"- Sentences: {result.total_sentences}",
        f"- Words: {result.total_words}",
        "",
        f"Checks passed: {result.passed_checks}/{result.total_checks}",
    ]

    if result.repetitions_sample:
        lines.extend(["", "Repeated 4-grams sample:"])
        lines.extend(f"- {ngram} ({count})" for ngram, count in result.repetitions_sample)

    if result.all_checks_passed:
        lines.extend(["", "Verdict: PASS"])
    else:
        failed = [name for name, value in result.meets_criteria.items() if not value]
        lines.extend(["", f"Verdict: FAIL ({', '.join(failed)})"])

    return "\n".join(lines)


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        text, source_name = read_input(args.source)
        analyzer = TextAnalyzer(text)
        result = analyzer.analyze(source_name)
    except (FileNotFoundError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return INPUT_ERROR_EXIT_CODE
    except Exception as error:  # pragma: no cover
        print(f"Unexpected analyzer error: {error}", file=sys.stderr)
        return INPUT_ERROR_EXIT_CODE

    if args.json:
        print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
    else:
        print(format_text_report(result))

    if args.strict and not result.all_checks_passed:
        return FAIL_EXIT_CODE

    return PASS_EXIT_CODE


if __name__ == "__main__":
    sys.exit(main())
