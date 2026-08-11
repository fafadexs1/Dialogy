-- Deixa as URLs de midia ja gravadas no formato duravel.
--
-- Dois defeitos se acumularam em `metadata.mediaUrl`:
--
-- 1) Assinatura com prazo. A Evolution entrega a midia do MinIO via
--    `presignedGetObject` sem prazo explicito, o que gera uma assinatura de 7
--    dias. Gravada como endereco definitivo, passada uma semana o arquivo seguia
--    intacto no bucket e o link e que morria. O bucket e de leitura publica,
--    entao o caminho sem querystring resolve sozinho e nao vence.
--
-- 2) Host antigo. O MinIO mudou de dominio
--    (evo-minio.fhgg2n.easypanel.host -> storage.klyraai.com.br) e os objetos
--    foram migrados com as mesmas chaves, mas as URLs gravadas continuaram
--    apontando para o endereco desativado. Verificado por amostragem: trocar o
--    host recupera a midia.
--
-- A aplicacao ja grava normalizado e tambem normaliza na leitura, entao esta
-- migration alinha o que esta no banco para os demais consumidores (exportacao,
-- campanhas, retry de envio, transcricao) que leem o valor cru.
--
-- Nestas URLs a querystring contem apenas parametros SigV4, entao cortar a
-- partir do '?' equivale a remover a assinatura.

-- 1. Host desativado -> host atual.
UPDATE messages
SET metadata = jsonb_set(
        metadata,
        '{mediaUrl}',
        to_jsonb(
            replace(
                metadata->>'mediaUrl',
                'evo-minio.fhgg2n.easypanel.host',
                'storage.klyraai.com.br'
            )
        )
    )
WHERE metadata->>'mediaUrl' LIKE '%evo-minio.fhgg2n.easypanel.host%';

-- 2. Remove a assinatura temporaria.
UPDATE messages
SET metadata = jsonb_set(
        metadata,
        '{mediaUrl}',
        to_jsonb(split_part(metadata->>'mediaUrl', '?', 1))
    )
WHERE metadata->>'mediaUrl' LIKE '%X-Amz-Signature=%';
