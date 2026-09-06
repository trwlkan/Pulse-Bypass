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
 *
 * ВСЕ ALT-варианты (general_alt .. general_alt13) — 1-в-1 портированные
 * официальные "general (ALT*).bat" из Flowseal/zapret-discord-youtube
 * (проверено по актуальному main: ALT.bat .. ALT13.bat, ALT14 не существует
 * — итого 13 ALT-вариантов + базовая general = 14 официальных стратегий).
 * ИСПРАВЛЕНО: раньше было портировано только до ALT5 (6 стратегий из 14) —
 * ALT6..ALT13 отсутствовали, хотя именно они часто нужны, когда ALT..ALT5 не
 * проходят DPI конкретного провайдера. Разные комбинации dpi-desync
 * (fakedsplit/hostfakesplit/multisplit/multidisorder/syndata) и фулинга
 * (ts/badseq/rnd+sni). Смысл в том, что разное оборудование DPI у разных
 * провайдеров ловится по-разному — какая-то стратегия обязательно должна
 * подойти, отсюда и автоподбор (autoDetect в zapret-manager.js), который
 * перебирает их все и запоминает результат для конкретного устройства.
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
  },
  // ==========================================================================
  // НОВОЕ: остальные официальные ALT-варианты из Flowseal/zapret-discord-youtube
  // (general.bat семейство), на котором и основан этот движок. Портированы
  // 1-в-1 по логике DPI-обхода: заменены только %BIN%/%LISTS% -> {BIN}/{LISTS},
  // выкинуты игровые секции (%GameFilterTCP%/%GameFilterUDP%, тут их нет) и
  // quic_initial_dbankcloud_ru.bin заменён на ACTIVE_DISCORD_UDP.bin — в этой
  // сборке движка первого файла нет, а второй в оригинале служил тем же целям
  // до переименования Discord-пейлоада апстримом.
  // ==========================================================================
  {
    id: 'general_alt',
    name: 'General ALT',
    description:
      'Официальный вариант "general (ALT)": fake+fakedsplit с TTL-фулингом (ts) вместо multisplit. Хорошо заходит там, где провайдер режет по паттерну multisplit/seqovl.',
    args: args(`
      --wf-tcp=${WF_TCP} --wf-udp=${WF_UDP}
      --filter-udp=443 ${GENERAL_HOSTLISTS} --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-udp=19294-19344,50000-50100 --filter-l7=discord,stun --dpi-desync=fake --dpi-desync-fake-discord={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-fake-stun={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-repeats=6 --new
      --filter-tcp=2053,2083,2087,2096,8443 --hostlist-domains=discord.media --dpi-desync=fake,fakedsplit --dpi-desync-repeats=6 --dpi-desync-fooling=ts --dpi-desync-fakedsplit-pattern=0x00 --dpi-desync-fake-tls={BIN}tls_clienthello_www_google_com.bin --new
      --filter-tcp=443 --hostlist={LISTS}list-google.txt --ip-id=zero --dpi-desync=fake,fakedsplit --dpi-desync-repeats=6 --dpi-desync-fooling=ts --dpi-desync-fakedsplit-pattern=0x00 --dpi-desync-fake-tls={BIN}tls_clienthello_www_google_com.bin --new
      --filter-tcp=80,443 ${GENERAL_HOSTLISTS} --dpi-desync=fake,fakedsplit --dpi-desync-repeats=6 --dpi-desync-fooling=ts --dpi-desync-fakedsplit-pattern=0x00 --dpi-desync-fake-tls={BIN}stun.bin --dpi-desync-fake-tls={BIN}tls_clienthello_www_google_com.bin --dpi-desync-fake-http={BIN}tls_clienthello_max_ru.bin --new
      --filter-udp=443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-tcp=80,443,8443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake,fakedsplit --dpi-desync-repeats=6 --dpi-desync-fooling=ts --dpi-desync-fakedsplit-pattern=0x00 --dpi-desync-fake-tls={BIN}stun.bin --dpi-desync-fake-tls={BIN}tls_clienthello_www_google_com.bin --dpi-desync-fake-http={BIN}tls_clienthello_max_ru.bin
    `)
  },
  {
    id: 'general_alt3',
    name: 'General ALT3',
    description:
      'Официальный вариант "general (ALT3)": hostfakesplit с подменой SNI на www.google.com/ya.ru. Часто помогает там, где ТСПУ блокирует именно по совпадению SNI с реальным доменом.',
    args: args(`
      --wf-tcp=${WF_TCP} --wf-udp=${WF_UDP}
      --filter-udp=443 ${GENERAL_HOSTLISTS} --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-udp=19294-19344,50000-50100 --filter-l7=discord,stun --dpi-desync=fake --dpi-desync-fake-discord={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-fake-stun={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-repeats=6 --new
      --filter-tcp=2053,2083,2087,2096,8443 --hostlist-domains=discord.media --dpi-desync=fake,hostfakesplit --dpi-desync-fake-tls-mod=rnd,dupsid,sni=www.google.com --dpi-desync-hostfakesplit-mod=host=www.google.com,altorder=1 --dpi-desync-fooling=ts --new
      --filter-tcp=443 --hostlist={LISTS}list-google.txt --ip-id=zero --dpi-desync=fake,hostfakesplit --dpi-desync-fake-tls-mod=rnd,dupsid,sni=www.google.com --dpi-desync-hostfakesplit-mod=host=www.google.com,altorder=1 --dpi-desync-fooling=ts --new
      --filter-tcp=80,443 ${GENERAL_HOSTLISTS} --dpi-desync=fake,hostfakesplit --dpi-desync-fake-tls-mod=rnd,dupsid,sni=ya.ru --dpi-desync-hostfakesplit-mod=host=ya.ru,altorder=1 --dpi-desync-fooling=ts --dpi-desync-fake-http={BIN}tls_clienthello_max_ru.bin --new
      --filter-udp=443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-tcp=80,443,8443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake,hostfakesplit --dpi-desync-fake-tls-mod=rnd,dupsid,sni=ya.ru --dpi-desync-hostfakesplit-mod=host=ya.ru,altorder=1 --dpi-desync-fooling=ts --dpi-desync-fake-http={BIN}tls_clienthello_max_ru.bin
    `)
  },
  {
    id: 'general_alt4',
    name: 'General ALT4',
    description:
      'Официальный вариант "general (ALT4)": fake+multisplit с badseq-фулингом и большим приращением номера последовательности (increment=1000). Альтернатива ALT/ALT3 по фулингу.',
    args: args(`
      --wf-tcp=${WF_TCP} --wf-udp=${WF_UDP}
      --filter-udp=443 ${GENERAL_HOSTLISTS} --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-udp=19294-19344,50000-50100 --filter-l7=discord,stun --dpi-desync=fake --dpi-desync-fake-discord={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-fake-stun={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-repeats=6 --new
      --filter-tcp=2053,2083,2087,2096,8443 --hostlist-domains=discord.media --dpi-desync=fake,multisplit --dpi-desync-repeats=6 --dpi-desync-fooling=badseq --dpi-desync-badseq-increment=1000 --dpi-desync-fake-tls={BIN}tls_clienthello_www_google_com.bin --new
      --filter-tcp=443 --hostlist={LISTS}list-google.txt --ip-id=zero --dpi-desync=fake,multisplit --dpi-desync-repeats=6 --dpi-desync-fooling=badseq --dpi-desync-badseq-increment=1000 --dpi-desync-fake-tls={BIN}tls_clienthello_www_google_com.bin --new
      --filter-tcp=80,443 ${GENERAL_HOSTLISTS} --dpi-desync=fake,multisplit --dpi-desync-repeats=6 --dpi-desync-fooling=badseq --dpi-desync-badseq-increment=1000 --dpi-desync-fake-tls={BIN}stun.bin --dpi-desync-fake-tls={BIN}tls_clienthello_www_google_com.bin --dpi-desync-fake-http={BIN}tls_clienthello_max_ru.bin --new
      --filter-udp=443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-tcp=80,443,8443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake,multisplit --dpi-desync-repeats=6 --dpi-desync-fooling=badseq --dpi-desync-badseq-increment=1000 --dpi-desync-fake-tls={BIN}stun.bin --dpi-desync-fake-tls={BIN}tls_clienthello_www_google_com.bin --dpi-desync-fake-http={BIN}tls_clienthello_max_ru.bin
    `)
  },
  {
    id: 'general_alt5',
    name: 'General ALT5 (универсальная, без списка доменов)',
    description:
      'Официальный вариант "general (ALT5)", помечен апстримом как "не рекомендуется" — но именно поэтому полезен как крайний вариант: syndata+multidisorder применяется ко ВСЕМ TCP-соединениям на портах 80/443/2053-8443, а не только к доменам из списка. Не зависит от того, добавлен сайт в список или нет, но нагружает канал сильнее остальных стратегий.',
    args: args(`
      --wf-tcp=${WF_TCP} --wf-udp=${WF_UDP}
      --filter-udp=443 ${GENERAL_HOSTLISTS} --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-udp=19294-19344,50000-50100 --filter-l7=discord,stun --dpi-desync=fake --dpi-desync-fake-discord={BIN}quic_initial_www_google_com.bin --dpi-desync-fake-stun={BIN}quic_initial_www_google_com.bin --dpi-desync-repeats=6 --new
      --filter-l3=ipv4 --filter-tcp=80,443,2053,2083,2087,2096,8443 --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=syndata,multidisorder --new
      --filter-udp=443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin
    `)
  },
  // ==========================================================================
  // ДОБАВЛЕНО: раньше здесь останавливались на ALT5, хотя официальный
  // репозиторий Flowseal/zapret-discord-youtube (main) содержит ALT-варианты
  // вплоть до ALT13 включительно (general.bat + general (ALT).bat .. general
  // (ALT13).bat = 14 файлов общим счётом). Портированы 1-в-1 по той же схеме,
  // что и general_alt..general_alt5 выше: %BIN%/%LISTS% -> {BIN}/{LISTS},
  // секции с игровым фильтром (%GameFilterTCP%/%GameFilterUDP%) выброшены -
  // в этом приложении нет отдельного игрового фильтра, а пустой список портов
  // ломает winws.exe (та же причина, по которой их не было у general..alt5).
  // ==========================================================================
  {
    id: 'general_alt6',
    name: 'General ALT6',
    description:
      'Официальный вариант "general (ALT6)": как базовая General, но split-seqovl=681/pos=1 (более позднее смещение в TLS ClientHello) вместо 568/1 у базовой.',
    args: args(`
      --wf-tcp=${WF_TCP} --wf-udp=${WF_UDP}
      --filter-udp=443 ${GENERAL_HOSTLISTS} --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-udp=19294-19344,50000-50100 --filter-l7=discord,stun --dpi-desync=fake --dpi-desync-fake-discord={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-fake-stun={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-repeats=6 --new
      --filter-tcp=2053,2083,2087,2096,8443 --hostlist-domains=discord.media --dpi-desync=multisplit --dpi-desync-split-seqovl=681 --dpi-desync-split-pos=1 --dpi-desync-split-seqovl-pattern={BIN}tls_clienthello_www_google_com.bin --new
      --filter-tcp=443 --hostlist={LISTS}list-google.txt --ip-id=zero --dpi-desync=multisplit --dpi-desync-split-seqovl=681 --dpi-desync-split-pos=1 --dpi-desync-split-seqovl-pattern={BIN}tls_clienthello_www_google_com.bin --new
      --filter-tcp=80,443 ${GENERAL_HOSTLISTS} --dpi-desync=multisplit --dpi-desync-split-seqovl=681 --dpi-desync-split-pos=1 --dpi-desync-split-seqovl-pattern={BIN}tls_clienthello_www_google_com.bin --new
      --filter-udp=443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-tcp=80,443,8443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=multisplit --dpi-desync-split-seqovl=681 --dpi-desync-split-pos=1 --dpi-desync-split-seqovl-pattern={BIN}tls_clienthello_www_google_com.bin
    `)
  },
  {
    id: 'general_alt7',
    name: 'General ALT7',
    description:
      'Официальный вариант "general (ALT7)": multisplit с разбивкой по позиции "sniext+1" (сразу после SNI-расширения) вместо фиксированного смещения. Последняя секция — syndata без multisplit.',
    args: args(`
      --wf-tcp=${WF_TCP} --wf-udp=${WF_UDP}
      --filter-udp=443 ${GENERAL_HOSTLISTS} --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-udp=19294-19344,50000-50100 --filter-l7=discord,stun --dpi-desync=fake --dpi-desync-fake-discord={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-fake-stun={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-repeats=6 --new
      --filter-tcp=2053,2083,2087,2096,8443 --hostlist-domains=discord.media --dpi-desync=multisplit --dpi-desync-split-pos=2,sniext+1 --dpi-desync-split-seqovl=679 --dpi-desync-split-seqovl-pattern={BIN}tls_clienthello_www_google_com.bin --new
      --filter-tcp=443 --hostlist={LISTS}list-google.txt --ip-id=zero --dpi-desync=multisplit --dpi-desync-split-pos=2,sniext+1 --dpi-desync-split-seqovl=679 --dpi-desync-split-seqovl-pattern={BIN}tls_clienthello_www_google_com.bin --new
      --filter-tcp=80,443 ${GENERAL_HOSTLISTS} --dpi-desync=multisplit --dpi-desync-split-pos=2,sniext+1 --dpi-desync-split-seqovl=679 --dpi-desync-split-seqovl-pattern={BIN}tls_clienthello_www_google_com.bin --new
      --filter-udp=443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-tcp=80,443,8443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=syndata
    `)
  },
  {
    id: 'general_alt8',
    name: 'General ALT8',
    description:
      'Официальный вариант "general (ALT8)": одиночный fake без mod (fake-tls-mod=none) с badseq-фулингом и небольшим increment=2 — лёгкая по нагрузке стратегия.',
    args: args(`
      --wf-tcp=${WF_TCP} --wf-udp=${WF_UDP}
      --filter-udp=443 ${GENERAL_HOSTLISTS} --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-udp=19294-19344,50000-50100 --filter-l7=discord,stun --dpi-desync=fake --dpi-desync-fake-discord={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-fake-stun={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-repeats=6 --new
      --filter-tcp=2053,2083,2087,2096,8443 --hostlist-domains=discord.media --dpi-desync=fake --dpi-desync-fake-tls-mod=none --dpi-desync-repeats=6 --dpi-desync-fooling=badseq --dpi-desync-badseq-increment=2 --new
      --filter-tcp=443 --hostlist={LISTS}list-google.txt --ip-id=zero --dpi-desync=fake --dpi-desync-fake-tls-mod=none --dpi-desync-repeats=6 --dpi-desync-fooling=badseq --dpi-desync-badseq-increment=2 --new
      --filter-tcp=80,443 ${GENERAL_HOSTLISTS} --dpi-desync=fake --dpi-desync-fake-tls-mod=none --dpi-desync-repeats=6 --dpi-desync-fooling=badseq --dpi-desync-badseq-increment=2 --dpi-desync-fake-http={BIN}tls_clienthello_max_ru.bin --new
      --filter-udp=443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-tcp=80,443,8443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake --dpi-desync-fake-tls-mod=none --dpi-desync-repeats=6 --dpi-desync-fooling=badseq --dpi-desync-badseq-increment=2 --dpi-desync-fake-http={BIN}tls_clienthello_max_ru.bin
    `)
  },
  {
    id: 'general_alt9',
    name: 'General ALT9',
    description:
      'Официальный вариант "general (ALT9)": hostfakesplit с подменой хоста на www.google.com/ozon.ru вместо multisplit/fake — альтернативный метод обхода по сравнению с ALT3/ALT12/ALT13.',
    args: args(`
      --wf-tcp=${WF_TCP} --wf-udp=${WF_UDP}
      --filter-udp=443 ${GENERAL_HOSTLISTS} --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-udp=19294-19344,50000-50100 --filter-l7=discord,stun --dpi-desync=fake --dpi-desync-fake-discord={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-fake-stun={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-repeats=6 --new
      --filter-tcp=2053,2083,2087,2096,8443 --hostlist-domains=discord.media --dpi-desync=hostfakesplit --dpi-desync-repeats=4 --dpi-desync-fooling=ts --dpi-desync-hostfakesplit-mod=host=www.google.com --new
      --filter-tcp=443 --hostlist={LISTS}list-google.txt --ip-id=zero --dpi-desync=hostfakesplit --dpi-desync-repeats=4 --dpi-desync-fooling=ts --dpi-desync-hostfakesplit-mod=host=www.google.com --new
      --filter-tcp=80,443 ${GENERAL_HOSTLISTS} --dpi-desync=hostfakesplit --dpi-desync-repeats=4 --dpi-desync-fooling=ts,md5sig --dpi-desync-hostfakesplit-mod=host=ozon.ru --new
      --filter-udp=443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-tcp=80,443,8443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=hostfakesplit --dpi-desync-repeats=4 --dpi-desync-fooling=ts --dpi-desync-hostfakesplit-mod=host=ozon.ru
    `)
  },
  {
    id: 'general_alt10',
    name: 'General ALT10',
    description:
      'Официальный вариант "general (ALT10)": одиночный fake с fake-tls-mod=none и ts-фулингом (без badseq) — похож на ALT8, но с другим фулингом и без increment.',
    args: args(`
      --wf-tcp=${WF_TCP} --wf-udp=${WF_UDP}
      --filter-udp=443 ${GENERAL_HOSTLISTS} --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-udp=19294-19344,50000-50100 --filter-l7=discord,stun --dpi-desync=fake --dpi-desync-fake-discord={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-fake-stun={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-repeats=6 --new
      --filter-tcp=2053,2083,2087,2096,8443 --hostlist-domains=discord.media --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fooling=ts --dpi-desync-fake-tls={BIN}tls_clienthello_www_google_com.bin --dpi-desync-fake-tls-mod=none --new
      --filter-tcp=443 --hostlist={LISTS}list-google.txt --ip-id=zero --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fooling=ts --dpi-desync-fake-tls={BIN}tls_clienthello_www_google_com.bin --new
      --filter-tcp=80,443 ${GENERAL_HOSTLISTS} --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fooling=ts --dpi-desync-fake-tls={BIN}stun.bin --dpi-desync-fake-tls={BIN}tls_clienthello_4pda_to.bin --dpi-desync-fake-http={BIN}tls_clienthello_max_ru.bin --new
      --filter-udp=443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-tcp=80,443,8443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fooling=ts --dpi-desync-fake-tls={BIN}stun.bin --dpi-desync-fake-tls={BIN}tls_clienthello_4pda_to.bin --dpi-desync-fake-http={BIN}tls_clienthello_max_ru.bin
    `)
  },
  {
    id: 'general_alt11',
    name: 'General ALT11',
    description:
      'Официальный вариант "general (ALT11)": усиленный fake+multisplit (repeats=8-11) с ts-фулингом и доп. fake-tls поверх split-seqovl=681/664 — комбинация ALT/ALT2 и повышенных повторов.',
    args: args(`
      --wf-tcp=${WF_TCP} --wf-udp=${WF_UDP}
      --filter-udp=443 ${GENERAL_HOSTLISTS} --dpi-desync=fake --dpi-desync-repeats=11 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-udp=19294-19344,50000-50100 --filter-l7=discord,stun --dpi-desync=fake --dpi-desync-fake-discord={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-fake-stun={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-repeats=6 --new
      --filter-tcp=2053,2083,2087,2096,8443 --hostlist-domains=discord.media --dpi-desync=fake,multisplit --dpi-desync-split-seqovl=681 --dpi-desync-split-pos=1 --dpi-desync-fooling=ts --dpi-desync-repeats=8 --dpi-desync-split-seqovl-pattern={BIN}tls_clienthello_www_google_com.bin --dpi-desync-fake-tls={BIN}tls_clienthello_www_google_com.bin --new
      --filter-tcp=443 --hostlist={LISTS}list-google.txt --ip-id=zero --dpi-desync=fake,multisplit --dpi-desync-split-seqovl=681 --dpi-desync-split-pos=1 --dpi-desync-fooling=ts --dpi-desync-repeats=8 --dpi-desync-split-seqovl-pattern={BIN}tls_clienthello_www_google_com.bin --dpi-desync-fake-tls={BIN}tls_clienthello_www_google_com.bin --new
      --filter-tcp=80,443 ${GENERAL_HOSTLISTS} --dpi-desync=fake,multisplit --dpi-desync-split-seqovl=664 --dpi-desync-split-pos=1 --dpi-desync-fooling=ts --dpi-desync-repeats=8 --dpi-desync-split-seqovl-pattern={BIN}tls_clienthello_max_ru.bin --dpi-desync-fake-tls={BIN}stun2.bin --dpi-desync-fake-tls={BIN}tls_clienthello_max_ru.bin --dpi-desync-fake-http={BIN}tls_clienthello_max_ru.bin --new
      --filter-udp=443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake --dpi-desync-repeats=11 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-tcp=80,443,8443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake,multisplit --dpi-desync-split-seqovl=664 --dpi-desync-split-pos=1 --dpi-desync-fooling=ts --dpi-desync-repeats=8 --dpi-desync-split-seqovl-pattern={BIN}tls_clienthello_max_ru.bin --dpi-desync-fake-tls={BIN}stun2.bin --dpi-desync-fake-tls={BIN}tls_clienthello_max_ru.bin --dpi-desync-fake-http={BIN}tls_clienthello_max_ru.bin
    `)
  },
  {
    id: 'general_alt12',
    name: 'General ALT12',
    description:
      'Официальный вариант "general (ALT12)": смесь fake+multisplit (Discord) и hostfakesplit (Google) в одной стратегии — сочетает подходы ALT9 и ALT11.',
    args: args(`
      --wf-tcp=${WF_TCP} --wf-udp=${WF_UDP}
      --filter-udp=443 ${GENERAL_HOSTLISTS} --dpi-desync=fake --dpi-desync-repeats=11 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-udp=19294-19344,50000-50100 --filter-l7=discord,stun --dpi-desync=fake --dpi-desync-fake-discord={BIN}stun.bin --dpi-desync-fake-discord={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-fake-stun={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-repeats=3 --new
      --filter-tcp=2053,2083,2087,2096,8443 --hostlist-domains=discord.media --dpi-desync=fake,multisplit --dpi-desync-split-seqovl=681 --dpi-desync-split-pos=1 --dpi-desync-fooling=ts --dpi-desync-repeats=8 --dpi-desync-split-seqovl-pattern={BIN}tls_clienthello_www_google_com.bin --dpi-desync-fake-tls={BIN}tls_clienthello_www_google_com.bin --new
      --filter-tcp=443 --hostlist={LISTS}list-google.txt --ip-id=zero --dpi-desync=hostfakesplit --dpi-desync-fooling=ts --dpi-desync-hostfakesplit-mod=host=www.google.com --new
      --filter-tcp=80,443 ${GENERAL_HOSTLISTS} --dpi-desync=fake,multisplit --dpi-desync-split-seqovl=664 --dpi-desync-split-pos=1 --dpi-desync-fooling=ts --dpi-desync-repeats=8 --dpi-desync-split-seqovl-pattern={BIN}tls_clienthello_max_ru.bin --dpi-desync-fake-tls={BIN}stun.bin --dpi-desync-fake-tls={BIN}tls_clienthello_max_ru.bin --dpi-desync-fake-http={BIN}tls_clienthello_max_ru.bin --new
      --filter-udp=443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake --dpi-desync-repeats=11 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-tcp=80,443,8443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake,multisplit --dpi-desync-split-seqovl=664 --dpi-desync-split-pos=1 --dpi-desync-fooling=ts --dpi-desync-repeats=8 --dpi-desync-split-seqovl-pattern={BIN}tls_clienthello_max_ru.bin --dpi-desync-fake-tls={BIN}stun.bin --dpi-desync-fake-tls={BIN}tls_clienthello_max_ru.bin --dpi-desync-fake-http={BIN}tls_clienthello_max_ru.bin
    `)
  },
  {
    id: 'general_alt13',
    name: 'General ALT13',
    description:
      'Официальный вариант "general (ALT13)": похож на ALT12, но Google идёт через hostfakesplit без доп. параметров, а базовый список доменов — через fake,hostfakesplit с host=mail.ru и sochi_park-паттерном. Самый свежий из портированных ALT-вариантов.',
    args: args(`
      --wf-tcp=${WF_TCP} --wf-udp=${WF_UDP}
      --filter-udp=443 ${GENERAL_HOSTLISTS} --dpi-desync=fake --dpi-desync-repeats=11 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-udp=19294-19344,50000-50100 --filter-l7=discord,stun --dpi-desync=fake --dpi-desync-fake-discord={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-fake-stun={BIN}ACTIVE_DISCORD_UDP.bin --dpi-desync-repeats=5 --new
      --filter-tcp=2053,2083,2087,2096,8443 --hostlist-domains=discord.media --dpi-desync=fake,multisplit --dpi-desync-split-seqovl=681 --dpi-desync-split-pos=1 --dpi-desync-fooling=ts --dpi-desync-repeats=7 --dpi-desync-split-seqovl-pattern={BIN}tls_clienthello_www_google_com.bin --dpi-desync-fake-tls={BIN}tls_clienthello_www_google_com.bin --new
      --filter-tcp=443 --hostlist={LISTS}list-google.txt --dpi-desync=hostfakesplit --dpi-desync-fooling=ts --dpi-desync-hostfakesplit-mod=host=www.google.com --new
      --filter-tcp=80,443 ${GENERAL_HOSTLISTS} --dpi-desync=fake,hostfakesplit --dpi-desync-fooling=ts --dpi-desync-hostfakesplit-mod=host=mail.ru,altorder=1 --dpi-desync-repeats=5 --dpi-desync-fake-tls={BIN}tls_clienthello_sochi_park.bin --dpi-desync-fake-tls={BIN}stun2.bin --dpi-desync-fake-http={BIN}tls_clienthello_sochi_park.bin --new
      --filter-udp=443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake --dpi-desync-repeats=11 --dpi-desync-fake-quic={BIN}quic_initial_www_google_com.bin --new
      --filter-tcp=80,443,8443 --ipset={LISTS}ipset-all.txt --hostlist-exclude={LISTS}list-exclude.txt --hostlist-exclude={LISTS}list-exclude-user.txt --ipset-exclude={LISTS}ipset-exclude.txt --dpi-desync=fake,hostfakesplit --dpi-desync-fooling=ts --dpi-desync-hostfakesplit-mod=host=mail.ru,altorder=1 --dpi-desync-repeats=5 --dpi-desync-fake-tls={BIN}tls_clienthello_sochi_park.bin --dpi-desync-fake-tls={BIN}stun2.bin --dpi-desync-fake-http={BIN}tls_clienthello_sochi_park.bin
    `)
  }
];

function getStrategy(id) {
  return STRATEGIES.find((s) => s.id === id) || null;
}

module.exports = { STRATEGIES, getStrategy };
