'use strict';

/**
 * Стратегии обхода DPI для движка zapret (winws.exe / WinDivert).
 *
 * Это НЕ эксплойт и не атака — winws.exe штатно перехватывает исходящий
 * трафик самого устройства через драйвер WinDivert и слегка видоизменяет
 * пакеты (разбивка TLS ClientHello, фейковые пакеты, автоподбор TTL и т.д.),
 * чтобы оборудование DPI на стороне провайдера не могло определить домен
 * назначения по открытому SNI и не блокировало/не резало соединение.
 * Реальный трафик сайта при этом не подделывается и не подменяется.
 *
 * args — массив аргументов командной строки winws.exe (без экранирования
 * shell, передаётся напрямую в child_process.spawn).
 * {LISTS} заменяется на путь к объединённому hostlist-файлу перед запуском.
 */

const BASE_TCP_PORTS = '80,443,2053,2083,2087,2096,8443';
const BASE_UDP_PORTS = '443,50000-50100';

const STRATEGIES = [
  {
    id: 'fake_split2',
    name: 'Fake + Split (базовая)',
    description: 'Лёгкая стратегия: разбиение TLS ClientHello и фейковый пакет перед ним. Хорошо работает против простых DPI по SNI.',
    args: [
      '--wf-tcp=' + BASE_TCP_PORTS,
      '--wf-udp=' + BASE_UDP_PORTS,
      '--filter-tcp=443',
      '--hostlist={LISTS}',
      '--dpi-desync=fake,split2',
      '--dpi-desync-ttl=3',
      '--dpi-desync-fooling=badseq',
      '--dpi-desync-repeats=6',
      '--new',
      '--filter-tcp=80',
      '--dpi-desync=fake,split2',
      '--dpi-desync-fooling=datanoack'
    ]
  },
  {
    id: 'multisplit',
    name: 'Multisplit',
    description: 'Сегментирует пакет в нескольких точках с перекрытием — хорошо держит более агрессивные ТСПУ-профили.',
    args: [
      '--wf-tcp=' + BASE_TCP_PORTS,
      '--wf-udp=' + BASE_UDP_PORTS,
      '--filter-tcp=443',
      '--hostlist={LISTS}',
      '--dpi-desync=multisplit',
      '--dpi-desync-split-seqovl=1',
      '--dpi-desync-split-seqovl-pattern=tls_clienthello_www_google_com',
      '--dpi-desync-fooling=badseq'
    ]
  },
  {
    id: 'fake_multisplit',
    name: 'Fake + Multisplit (усиленная)',
    description: 'Комбинация фейкового пакета и множественной сегментации. Медленнее, но устойчивее к обновлениям ТСПУ.',
    args: [
      '--wf-tcp=' + BASE_TCP_PORTS,
      '--wf-udp=' + BASE_UDP_PORTS,
      '--filter-tcp=443',
      '--hostlist={LISTS}',
      '--dpi-desync=fake,multisplit',
      '--dpi-desync-repeats=8',
      '--dpi-desync-fooling=badseq,datanoack',
      '--dpi-desync-fake-tls=default'
    ]
  },
  {
    id: 'disorder2',
    name: 'Disorder2',
    description: 'Отправляет сегменты не по порядку, сбивая сборку пакета на стороне DPI-анализатора.',
    args: [
      '--wf-tcp=' + BASE_TCP_PORTS,
      '--wf-udp=' + BASE_UDP_PORTS,
      '--filter-tcp=443',
      '--hostlist={LISTS}',
      '--dpi-desync=disorder2',
      '--dpi-desync-ttl=4',
      '--dpi-desync-repeats=6'
    ]
  },
  {
    id: 'fake_tls_auto',
    name: 'Fake TLS Auto + Autottl',
    description: 'Автоматический подбор TTL для фейкового пакета — универсальный вариант «на всякий случай», если остальные не подошли.',
    args: [
      '--wf-tcp=' + BASE_TCP_PORTS,
      '--wf-udp=' + BASE_UDP_PORTS,
      '--filter-tcp=443',
      '--hostlist={LISTS}',
      '--dpi-desync=fake,split2',
      '--dpi-desync-autottl=2',
      '--dpi-desync-fooling=badseq',
      '--dpi-desync-fake-tls=default',
      '--dpi-desync-repeats=10'
    ]
  },
  {
    id: 'goodbyedpi_style',
    name: 'GoodbyeDPI-style (fake + autottl)',
    description: 'Пресет по мотивам классических настроек GoodbyeDPI: TTL подбирается автоматически так, чтобы фейковый пакет доходил до DPI провайдера, но не долетал до сервера. Отдельная ветка для 80 и 443 порта, без сегментации. Иногда работает там, где не помогают split-стратегии выше.',
    args: [
      '--wf-tcp=80,443',
      '--wf-udp=' + BASE_UDP_PORTS,
      '--filter-tcp=80',
      '--hostlist={LISTS}',
      '--dpi-desync=fake,disorder',
      '--dpi-desync-autottl=1',
      '--dpi-desync-fooling=datanoack',
      '--dpi-desync-repeats=10',
      '--new',
      '--filter-tcp=443',
      '--hostlist={LISTS}',
      '--dpi-desync=fake,disorder',
      '--dpi-desync-autottl=1',
      '--dpi-desync-fooling=badseq',
      '--dpi-desync-fake-tls=default',
      '--dpi-desync-repeats=10'
    ]
  },
  {
    id: 'udp_quic',
    name: 'UDP/QUIC (для Discord)',
    description: 'Отдельная ветка для UDP/QUIC-трафика голосовых звонков Discord — фейковые UDP-пакеты перед реальными.',
    args: [
      '--wf-tcp=' + BASE_TCP_PORTS,
      '--wf-udp=' + BASE_UDP_PORTS,
      '--filter-udp=443',
      '--hostlist={LISTS}',
      '--dpi-desync=fake',
      '--dpi-desync-repeats=6',
      '--dpi-desync-fake-quic=default',
      '--new',
      '--filter-tcp=443',
      '--hostlist={LISTS}',
      '--dpi-desync=fake,split2',
      '--dpi-desync-fooling=badseq'
    ]
  }
];

function getStrategy(id) {
  return STRATEGIES.find((s) => s.id === id) || null;
}

module.exports = { STRATEGIES, getStrategy };
