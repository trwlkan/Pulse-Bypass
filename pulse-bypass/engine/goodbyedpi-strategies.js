'use strict';

/**
 * Стратегии GoodbyeDPI — готовые режимы обхода DPI.
 * Каждый режим — это набор флагов goodbyedpi.exe.
 * Источник: https://github.com/ValdikSS/GoodbyeDPI
 */

const STRATEGIES = [
  {
    id: 'gd_mode9',
    name: 'Авто (рекомендуется)',
    description: 'Режим -9: wrong-seq + wrong-chksum + reverse-frag + block QUIC. Стабильный и быстрый.',
    args: ['-9'],
    recommended: true
  },
  {
    id: 'gd_mode7',
    name: 'Wrong checksum (-7)',
    description: 'Режим -7: wrong-chksum + reverse-frag. Безопасный фейк-пакет с неверной контрольной суммой.',
    args: ['-7']
  },
  {
    id: 'gd_mode5',
    name: 'Auto-TTL (-5)',
    description: 'Режим -5: auto-ttl + reverse-frag + max-payload. Автоматический подбор TTL.',
    args: ['-5']
  },
  {
    id: 'gd_mode8',
    name: 'Dual fake (-8)',
    description: 'Режим -8: wrong-seq + wrong-chksum + reverse-frag. Два разных фейк-пакета.',
    args: ['-8']
  },
  {
    id: 'gd_mode6',
    name: 'Wrong seq (-6)',
    description: 'Режим -6: wrong-seq + reverse-frag + max-payload. Фейк-пакет с неверным SEQ/ACK.',
    args: ['-6']
  },
  {
    id: 'gd_mode1',
    name: 'Совместимый (-1)',
    description: 'Режим -1: блокировка passive DPI + HTTP трюки. Максимальная совместимость.',
    args: ['-1']
  },
  {
    id: 'gd_mode3',
    name: 'Быстрый (-3)',
    description: 'Режим -3: блокировка passive DPI + HTTP трюки + HTTPS фрагментация.',
    args: ['-3']
  },
  {
    id: 'gd_mode4',
    name: 'Максимальная скорость (-4)',
    description: 'Режим -4: только базовые HTTP трюки, без фрагментации. Самый быстрый.',
    args: ['-4']
  },
  {
    id: 'gd_mode2',
    name: 'Совместимый HTTPS (-2)',
    description: 'Режим -2: совместимый с улучшенной скоростью HTTPS.',
    args: ['-2']
  },
  {
    id: 'gd_custom_fake',
    name: 'Fake packet + gen',
    description: 'Кастомный: -9 + fake-gen 15 + native-frag. Генерация случайных фейк-пакетов.',
    args: ['-9', '--fake-gen', '15', '--native-frag']
  },
  {
    id: 'gd_custom_e1',
    name: 'Режим -9 + e1',
    description: 'Режим -9 с увеличенной HTTPS фрагментацией. Помогает на некоторых провайдерах.',
    args: ['-9', '-e', '1']
  },
  {
    id: 'gd_custom_q',
    name: 'Без QUIC (-9 -q)',
    description: 'Режим -9 с явной блокировкой QUIC/HTTP3. Для проблемных провайдеров.',
    args: ['-9', '-q']
  },
  {
    id: 'gd_custom_ttl',
    name: 'Set-TTL 5',
    description: 'Фейк-пакет с фиксированным TTL=5. Работает на некоторых провайдерах.',
    args: ['-e', '2', '--fake-gen', '15', '--set-ttl', '5', '--native-frag', '-q']
  },
  {
    id: 'gd_custom_reverse',
    name: 'Reverse frag + e2',
    description: 'Обратная фрагментация + HTTPS фрагментация 2. Альтернативный подход.',
    args: ['-e', '2', '-f', '1', '--reverse-frag']
  },
  {
    id: 'gd_mode11',
    name: 'Экспериментальный (-11)',
    description: 'Режим -11. Используется на некоторых региональных провайдерах РФ.',
    args: ['-11']
  },
  {
    id: 'gd_custom_mix',
    name: 'Микс (-1 -e1)',
    description: 'Совместимый режим с HTTPS фрагментацией. Помогает на ТТК, МГТС.',
    args: ['-1', '-e', '1']
  }
];

function getStrategy(id) {
  return STRATEGIES.find((s) => s.id === id);
}

module.exports = { STRATEGIES, getStrategy };
