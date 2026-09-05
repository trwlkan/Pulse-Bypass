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
 * Аргументы взяты из официальной сборки bol-van/zapret (пакет
 * "zapret-discord-youtube", general*.bat) и адаптированы под наш движок:
 *  - {BIN}   заменяется на путь к папке engine/vendor/zapret/bin (со слэшем)
 *  - {LISTS} заменяется на путь к папке engine/vendor/zapret/lists (со слэшем),
 *            где list-general-user.txt / list-exclude-user.txt — это файлы,
 *            которые rebuildHostlist() перезаписывает пользовательскими
 *            доменами (custom + домены приложений), см. zapret-manager.js.
 *
 * Секции с игровым фильтром (%GameFilterTCP%/%GameFilterUDP%) из оригинальных
 * .bat-файлов не переносились — в этом приложении нет отдельного игрового
 * фильтра, а пустой список портов ломает winws.exe.
 */

const WF_TCP = '80,443,2053,2083,2087,2096,8443';
const WF_UDP = '443,19294-19344,50000-50100';

const GENERAL_HOSTLISTS =
  '--hostlist={LISTS}list-general.txt --hostlist={LISTS}list-general-user.txt ' +
  '--hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt ' +
  '--ipset-exclude={LISTS}ipset-exclude.txt';

function args(str) {
  // Разбиваем по пробелам/переносам строк, храня {BIN}/{LISTS} как часть токена
  return str.trim().split(/\s+/);
}

const STRATEGIES = [
  {
    id: 'general',
    name: 'General (базовая)',
    description:
      'Официальная базовая стратегия zapret: fake+multisplit по SNI, фейковые QUIC/STUN-пакеты для Discord. Хорошая отправная точка для большинства провайдеров.',
    args: args(`
      --wf-tcp=${WF_TCP} --wf-udp=${WF_UDP}
      --filter-udp=443 ${GENERAL_HOSTLISTS} --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-udp=19294-19344,50000-50100 --filter-l7=discord,stun --dpi-desync=fake --dpi-desync-fake-discord={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-fake-stun={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-repeats=6 --new
      --filter-tcp=2053,2083,2087,2096,8443 --hostlist-domains=discord.media --dpi-desync=multisplit --dpi-desync-split-seqovl=681 --dpi-desync-split-pos=1 --dpi-desync-split-seqovl-pattern={BIN}tls_clienthello_www_google_com.bin --new
      --filter-tcp=443 --hostlist={LISTS}list-google.txt --ip-id=zero --dpi-desync=multisplit --dpi-desync-split-seqovl=681 --dpi-desync-split-pos=1 --dpi-desync-split-seqovl-pattern={BIN}tls_clienthello_www_google_com.bin --new
      --filter-tcp=80,443 ${GENERAL_HOSTLISTS} --dpi-desync=multisplit --dpi-desync-split-seqovl=568 --dpi-desync-split-pos=1 --dpi-desync-split-seqovl-pattern={BIN}tls_clienthello_4pda_to.bin --new
      --filter-udp=443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-tcp=80,443,8443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=multisplit --dpi-desync-split-seqovl=568 --dpi-desync-split-pos=1 --dpi-desync-split-seqovl-pattern={BIN}tls_clienthello_4pda_to.bin
    `)
  },
  {
    id: 'general_alt2',
    name: 'General ALT2',
    description:
      'Вариант базовой стратегии с другим смещением split-seqovl (652/pos2) — помогает там, где ALT не проходит через DPI провайдера.',
    args: args(`
      --wf-tcp=${WF_TCP} --wf-udp=${WF_UDP}
      --filter-udp=443 ${GENERAL_HOSTLISTS} --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-udp=19294-19344,50000-50100 --filter-l7=discord,stun --dpi-desync=fake --dpi-desync-fake-discord={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-fake-stun={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-repeats=6 --new
      --filter-tcp=2053,2083,2087,2096,8443 --hostlist-domains=discord.media --dpi-desync=multisplit --dpi-desync-split-seqovl=652 --dpi-desync-split-pos=2 --dpi-desync-split-seqovl-pattern={BIN}tls_clienthello_www_google_com.bin --new
      --filter-tcp=443 --hostlist={LISTS}list-google.txt --ip-id=zero --dpi-desync=multisplit --dpi-desync-split-seqovl=652 --dpi-desync-split-pos=2 --dpi-desync-split-seqovl-pattern={BIN}tls_clienthello_www_google_com.bin --new
      --filter-tcp=80,443 ${GENERAL_HOSTLISTS} --dpi-desync=multisplit --dpi-desync-split-seqovl=652 --dpi-desync-split-pos=2 --dpi-desync-split-seqovl-pattern={BIN}tls_clienthello_www_google_com.bin --new
      --filter-udp=443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-tcp=80,443,8443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=multisplit --dpi-desync-split-seqovl=652 --dpi-desync-split-pos=2 --dpi-desync-split-seqovl-pattern={BIN}tls_clienthello_www_google_com.bin
    `)
  },
  {
    id: 'simple_fake',
    name: 'Simple Fake',
    description:
      'Более лёгкая стратегия на основе одиночных фейковых пакетов (без multisplit) — меньше нагрузка на CPU, подходит как первая попытка на слабом оборудовании ТСПУ.',
    args: args(`
      --wf-tcp=${WF_TCP} --wf-udp=${WF_UDP}
      --filter-udp=443 ${GENERAL_HOSTLISTS} --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-udp=19294-19344,50000-50100 --filter-l7=discord,stun --dpi-desync=fake --dpi-desync-fake-discord={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-fake-stun={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-repeats=6 --new
      --filter-tcp=2053,2083,2087,2096,8443 --hostlist-domains=discord.media --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fooling=ts --dpi-desync-fake-tls={BIN}tls_clienthello_www_google_com.bin --new
      --filter-tcp=443 --hostlist={LISTS}list-google.txt --ip-id=zero --dpi-desync=hostfakesplit --dpi-desync-fooling=ts --dpi-desync-hostfakesplit-mod=host=www.google.com --new
      --filter-tcp=80,443 ${GENERAL_HOSTLISTS} --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fooling=ts --dpi-desync-fake-tls={BIN}tls_clienthello_www_google_com.bin --dpi-desync-fake-http={BIN}tls_clienthello_max_ru.bin --new
      --filter-udp=443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-tcp=80,443,8443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fooling=ts --dpi-desync-fake-tls={BIN}tls_clienthello_www_google_com.bin --dpi-desync-fake-http={BIN}tls_clienthello_max_ru.bin
    `)
  },
  {
    id: 'fake_tls_auto',
    name: 'Fake TLS Auto + Multidisorder (усиленная)',
    description:
      'Самая агрессивная стратегия: multidisorder с поддельным TLS ClientHello (SNI www.google.com) и badseq-фулингом. Медленнее, но устойчивее к обновлениям ТСПУ.',
    args: args(`
      --wf-tcp=${WF_TCP} --wf-udp=${WF_UDP}
      --filter-udp=443 ${GENERAL_HOSTLISTS} --dpi-desync=fake --dpi-desync-repeats=11 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-udp=19294-19344,50000-50100 --filter-l7=discord,stun --dpi-desync=fake --dpi-desync-fake-discord={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-fake-stun={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-repeats=6 --new
      --filter-tcp=2053,2083,2087,2096,8443 --hostlist-domains=discord.media --dpi-desync=fake,multidisorder --dpi-desync-split-pos=1,midsld --dpi-desync-repeats=11 --dpi-desync-fooling=badseq --dpi-desync-fake-tls=0x00000000 --dpi-desync-fake-tls-mod=rnd,dupsid,sni=www.google.com --new
      --filter-tcp=443 --hostlist={LISTS}list-google.txt --ip-id=zero --dpi-desync=fake,multidisorder --dpi-desync-split-pos=1,midsld --dpi-desync-repeats=11 --dpi-desync-fooling=badseq --dpi-desync-fake-tls=0x00000000 --dpi-desync-fake-tls-mod=rnd,dupsid,sni=www.google.com --new
      --filter-tcp=80,443 ${GENERAL_HOSTLISTS} --dpi-desync=fake,multidisorder --dpi-desync-split-pos=1,midsld --dpi-desync-repeats=11 --dpi-desync-fooling=badseq --dpi-desync-fake-tls=0x00000000 --dpi-desync-fake-tls-mod=rnd,dupsid,sni=www.google.com --dpi-desync-fake-http={BIN}tls_clienthello_max_ru.bin --new
      --filter-udp=443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake --dpi-desync-repeats=11 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-tcp=80,443,8443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake,multidisorder --dpi-desync-split-pos=1,midsld --dpi-desync-repeats=11 --dpi-desync-fooling=badseq --dpi-desync-fake-tls=0x00000000 --dpi-desync-fake-tls-mod=rnd,dupsid,sni=www.google.com --dpi-desync-fake-http={BIN}tls_clienthello_max_ru.bin
    `)
  }
];

function getStrategy(id) {
  return STRATEGIES.find((s) => s.id === id) || null;
}

module.exports = { STRATEGIES, getStrategy };
