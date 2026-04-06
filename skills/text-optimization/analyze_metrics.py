#!/usr/bin/env python3
"""
Анализатор текстовых метрик для лонгридов
Основан на рекомендациях o3 для достижения оптимальной читабельности
"""

import re
from collections import Counter
from typing import Dict, List, Tuple

class TextAnalyzer:
    def __init__(self, text: str):
        self.text = text
        self.sentences = self._split_sentences(text)
        self.words = self._tokenize(text)
        
    def _split_sentences(self, text: str) -> List[str]:
        """Разбивает текст на предложения"""
        # Упрощённая версия для русского текста
        sentences = re.split(r'[.!?]+\s+', text)
        return [s.strip() for s in sentences if s.strip()]
    
    def _tokenize(self, text: str) -> List[str]:
        """Токенизация текста"""
        # Убираем знаки препинания и разбиваем на слова
        words = re.findall(r'\b[а-яА-ЯёЁa-zA-Z]+\b', text.lower())
        return words
    
    def _count_syllables(self, word: str) -> int:
        """Подсчёт слогов в русском слове (по гласным)"""
        vowels = 'аеёиоуыэюяaeiouy'
        return sum(1 for char in word.lower() if char in vowels)
    
    def flesch_reading_ease_ru(self) -> float:
        """Индекс Флеша для русского языка (адаптация Соловьёва)"""
        if not self.sentences or not self.words:
            return 0
            
        avg_sentence_length = len(self.words) / len(self.sentences)
        avg_syllables_per_word = sum(self._count_syllables(w) for w in self.words) / len(self.words)
        
        # Формула Флеша-Соловьёва для русского
        fre_ru = 206.835 - 1.52 * avg_sentence_length - 65.14 * avg_syllables_per_word
        return round(fre_ru, 1)
    
    def avg_sentence_length(self) -> float:
        """Средняя длина предложения в словах"""
        if not self.sentences:
            return 0
        total_words = sum(len(self._tokenize(s)) for s in self.sentences)
        return round(total_words / len(self.sentences), 1)
    
    def water_percentage(self) -> float:
        """Процент 'воды' - служебных и вводных слов"""
        water_words = {
            'очень', 'действительно', 'конечно', 'вообще', 'наверное',
            'возможно', 'кажется', 'видимо', 'просто', 'именно',
            'как бы', 'типа', 'короче', 'в общем', 'так сказать',
            'что', 'как', 'где', 'когда', 'если', 'чтобы', 'потому',
            'поэтому', 'однако', 'также', 'тоже', 'даже', 'лишь'
        }
        
        water_count = sum(1 for w in self.words if w in water_words)
        return round((water_count / len(self.words)) * 100, 1) if self.words else 0
    
    def passive_voice_percentage(self) -> float:
        """Процент пассивного залога (упрощённая версия)"""
        # Ищем типичные маркеры пассива
        passive_markers = r'\b(был[аио]?|будет|будут|является|являются|считается|считаются|называется|используется|применяется)\b'
        passive_count = len(re.findall(passive_markers, self.text, re.IGNORECASE))
        return round((passive_count / len(self.sentences)) * 100, 1) if self.sentences else 0
    
    def find_repetitions(self, n: int = 4) -> List[Tuple[str, int]]:
        """Находит повторяющиеся n-граммы"""
        ngrams = []
        words = self.words
        
        for i in range(len(words) - n + 1):
            ngram = ' '.join(words[i:i+n])
            ngrams.append(ngram)
        
        ngram_counts = Counter(ngrams)
        return [(ngram, count) for ngram, count in ngram_counts.items() if count >= 3]
    
    def lexical_diversity(self) -> float:
        """Type-Token Ratio - лексическое разнообразие"""
        if not self.words:
            return 0
        unique_words = set(self.words)
        return round(len(unique_words) / len(self.words), 3)
    
    def analyze(self) -> Dict:
        """Полный анализ текста"""
        results = {
            'flesch_ru': self.flesch_reading_ease_ru(),
            'avg_sentence_length': self.avg_sentence_length(),
            'water_percentage': self.water_percentage(),
            'passive_voice_percentage': self.passive_voice_percentage(),
            'lexical_diversity': self.lexical_diversity(),
            'repetitions_4gram': len(self.find_repetitions(4)),
            'total_sentences': len(self.sentences),
            'total_words': len(self.words)
        }
        
        # Оценка по критериям
        results['meets_criteria'] = {
            'flesch_ru': results['flesch_ru'] >= 55,
            'sentence_length': results['avg_sentence_length'] <= 18,
            'water': results['water_percentage'] <= 15,
            'passive_voice': results['passive_voice_percentage'] <= 10,
            'repetitions': results['repetitions_4gram'] == 0,
            'lexical_diversity': results['lexical_diversity'] > 0.42
        }
        
        return results

def analyze_file(filename: str):
    """Анализирует текстовый файл"""
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            text = f.read()
        
        analyzer = TextAnalyzer(text)
        results = analyzer.analyze()
        
        print(f"\n📊 Анализ текста: {filename}")
        print("=" * 50)
        
        print(f"\n📏 Основные метрики:")
        print(f"  • Flesch-RU: {results['flesch_ru']} {'✅' if results['meets_criteria']['flesch_ru'] else '❌'} (цель ≥ 55)")
        print(f"  • Средняя длина предложения: {results['avg_sentence_length']} слов {'✅' if results['meets_criteria']['sentence_length'] else '❌'} (цель ≤ 18)")
        print(f"  • Процент 'воды': {results['water_percentage']}% {'✅' if results['meets_criteria']['water'] else '❌'} (цель ≤ 15%)")
        print(f"  • Пассивный залог: {results['passive_voice_percentage']}% {'✅' if results['meets_criteria']['passive_voice'] else '❌'} (цель ≤ 10%)")
        print(f"  • Лексическое разнообразие: {results['lexical_diversity']} {'✅' if results['meets_criteria']['lexical_diversity'] else '❌'} (цель > 0.42)")
        print(f"  • Повторы 4-грамм: {results['repetitions_4gram']} {'✅' if results['meets_criteria']['repetitions'] else '❌'} (цель = 0)")
        
        print(f"\n📈 Статистика:")
        print(f"  • Всего предложений: {results['total_sentences']}")
        print(f"  • Всего слов: {results['total_words']}")
        
        # Проверка повторов
        if results['repetitions_4gram'] > 0:
            print(f"\n⚠️  Найдены повторяющиеся 4-граммы:")
            repetitions = analyzer.find_repetitions(4)
            for ngram, count in repetitions[:5]:  # Показываем топ-5
                print(f"    '{ngram}' - {count} раз")
        
        # Общая оценка
        passed = sum(results['meets_criteria'].values())
        total = len(results['meets_criteria'])
        print(f"\n🎯 Итоговая оценка: {passed}/{total} критериев выполнено")
        
        if passed == total:
            print("✨ Отличный результат! Текст соответствует всем критериям.")
        elif passed >= total * 0.8:
            print("👍 Хороший результат! Небольшие доработки сделают текст идеальным.")
        else:
            print("💡 Текст требует доработки для улучшения читабельности.")
            
    except FileNotFoundError:
        print(f"❌ Файл {filename} не найден")
    except Exception as e:
        print(f"❌ Ошибка при анализе: {e}")

if __name__ == "__main__":
    # Анализируем наши файлы
    print("🔍 Анализатор текстовых метрик v1.0")
    print("Основан на рекомендациях для качественных лонгридов")
    
    # Анализируем сбалансированную версию
    analyze_file("ТЕКСТ_СБАЛАНСИРОВАННЫЙ_FRE.md")
    
    print("\n" + "="*70 + "\n")
    
    # Анализируем оптимизированную версию
    analyze_file("ТЕКСТ_ОПТИМИЗИРОВАННЫЙ_FRE.md")
    
    print("\n" + "="*70 + "\n")
    
    # Анализируем полную версию для сравнения
    analyze_file("введение_ФИНАЛЬНАЯ_ВЕРСИЯ.md") 