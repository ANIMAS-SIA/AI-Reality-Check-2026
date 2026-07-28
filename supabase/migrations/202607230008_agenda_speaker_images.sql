alter table agenda_items
  add column if not exists speaker_image_url text;

update agenda_items
set speaker_image_url = 'https://raw.githubusercontent.com/ANIMAS-SIA/newsletter-assets/refs/heads/main/AI%20reality%20check%202026_Betija%20Muiz%CC%8Cniece_foto.png'
where speaker_name = 'Betija Deina Muižniece'
  and speaker_image_url is null;

update agenda_items
set speaker_image_url = 'https://raw.githubusercontent.com/ANIMAS-SIA/newsletter-assets/refs/heads/main/AI%20reality%20check%202026_Valdis%20Melderis_foto.png'
where speaker_name = 'Valdis Melderis'
  and speaker_image_url is null;
