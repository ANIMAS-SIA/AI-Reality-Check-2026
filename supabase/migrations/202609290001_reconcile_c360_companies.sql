-- Reconcile conference company aliases that were entered manually instead of
-- selected from Company360. Exact matches were verified against the C360 API.

with aliases(source_company_id, target_company_id) as (
  values
    ('c8fd82a8-7e86-4ae9-a168-9f43fd24fad8'::uuid, '21573ebd-f316-4ab2-ad7e-793edfe4f80a'::uuid), -- Numeri
    ('4090f019-491c-42b1-b3e1-960515a7782c'::uuid, '6d1c8ee6-383b-46f0-a51d-481b4d3c341c'::uuid), -- Concreto
    ('0a4ec0f1-78d4-42ca-b81d-f4701ad620fa'::uuid, '60af48e4-a843-48f3-9601-ce43b079e57c'::uuid), -- DVI
    ('194ce811-56f1-4269-8003-018300ab9803'::uuid, '58de92c1-ac62-480f-9076-913098239367'::uuid)  -- WWH Engineering
)
update participants p
set company_id = aliases.target_company_id,
    updated_at = now()
from aliases
where p.company_id = aliases.source_company_id;

with matches(
  id, registration_number, name, region, industry, company_size,
  address, legal_form, registered_date
) as (
  values
    ('124e8e73-192a-42b6-9623-a33c770d98c3'::uuid, '40203702500', 'SIA ASTOŅI SOĻI', 'Ropažu nov.', null, null, 'Ropažu nov., Garkalnes pag., Baltezers, Kursas iela 3', 'Sabiedrība ar ierobežotu atbildību', '2025-12-04'::date),
    ('5b2b655e-0365-4cd3-bcff-634ddc07edcd'::uuid, '40003032949', 'Akciju sabiedrība "Latvenergo"', 'Rīga', 'Elektroenerģijas ražošana no atjaunojamiem resursiem', 'Liels', 'Rīga, Pulkveža Brieža iela 12', 'Akciju sabiedrība', '1991-10-08'::date),
    ('47408117-1a2e-4fb6-95c2-7a67ae722dad'::uuid, '40008045795', 'Iekšējo Auditoru Institūts', 'Rīga', null, 'Mikro', 'Rīga, Pērses iela 9/11', 'Biedrība', '1999-10-26'::date),
    ('8a891712-d755-45e9-ab4d-5cd40e5ef877'::uuid, '40008301168', 'Biedrība "Latvijas Digitālais akselerators"', 'Rīga', null, 'Mazs', 'Rīga, Eksporta iela 5', 'Biedrība', '2020-10-12'::date),
    ('e1437966-8eb2-47e0-b51e-9075969f1055'::uuid, '40203725274', 'SIA "Mimo kids"', 'Ropažu nov.', null, null, 'Ropažu nov., Ropažu pag., Ropaži, "Pārupes 115"', 'Sabiedrība ar ierobežotu atbildību', '2026-02-27'::date),
    ('1991f8e6-d22e-4def-a565-60cf549a1637'::uuid, '41203042116', 'SIA "PB Finanses"', 'Ventspils', 'Uzskaites, grāmatvedības un revīzijas pakalpojumi; konsultācijas nodokļu jautājumos', 'Mazs', 'Ventspils, Lielais prospekts 54 - 9', 'Sabiedrība ar ierobežotu atbildību', '2011-10-31'::date),
    ('6f376b1b-013b-4754-84c3-956788691197'::uuid, '40203746473', 'Sabiedrība ar ierobežotu atbildību "Bergson"', 'Ropažu nov.', null, null, 'Ropažu nov., Ropažu pag., Podkājas, Lapu iela 1', 'Sabiedrība ar ierobežotu atbildību', '2026-05-14'::date),
    ('527568de-e500-447c-a620-7f40535478d8'::uuid, '40003815611', 'Sabiedrība ar ierobežotu atbildību "Evolution Latvia"', 'Rīga', 'Datošanas infrastruktūra, datu apstrāde, mitināšana un ar to saistītas darbības', 'Liels', 'Rīga, Brīvības iela 151', 'Sabiedrība ar ierobežotu atbildību', '2006-04-03'::date),
    ('1e103e64-1446-4363-88f9-d0346996327e'::uuid, '40203398626', 'SIA "SEV fabrics"', 'Ropažu nov.', 'Virsdrēbju ražošana', 'Mikro', 'Ropažu nov., Stopiņu pag., Rumbula, Gaitiņu iela 9', 'Sabiedrība ar ierobežotu atbildību', '2022-05-10'::date),
    ('9882cf0b-dc57-447d-8fcb-264a82297f8b'::uuid, '90000052497', 'Ventspils valstspilsētas pašvaldības iestāde "Ventspils Izglītības pārvalde"', 'Ventspils', null, null, 'Raiņa iela 10, Ventspils, LV-3601', 'INSTITUTION_OF_INDIRECT_ADMINISTRATION', '2018-03-29'::date)
)
update companies c
set c360_registration_number = matches.registration_number,
    name = matches.name,
    country = 'LV',
    status = 'active',
    legal_form = matches.legal_form,
    registered_date = matches.registered_date,
    address = matches.address,
    legal_address = matches.address,
    industry = coalesce(matches.industry, c.industry),
    company_size = coalesce(matches.company_size, c.company_size),
    company_size_badge = coalesce(matches.company_size, c.company_size_badge),
    region = coalesce(matches.region, c.region),
    c360_payload = coalesce(c.c360_payload, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'name', matches.name,
      'registration_number', matches.registration_number,
      'country', 'LV',
      'status', 'active',
      'legal_form', matches.legal_form,
      'registered_date', matches.registered_date,
      'address', matches.address,
      'industry', matches.industry,
      'company_size', matches.company_size,
      'company_size_badge', matches.company_size,
      'region', matches.region
    )),
    updated_at = now()
from matches
where c.id = matches.id
  and c.c360_registration_number is null;
