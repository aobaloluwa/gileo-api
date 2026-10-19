-- Optional DEMO CONTENT only. Run manually in a development/demo database.
-- Prices are illustrative; confirm all prices and inventory with GILEO before production.
INSERT INTO product_categories ("id","name","slug","description","createdAt","updatedAt")
VALUES
(gen_random_uuid(),'Gileo Scrubs & Medical Wear','gileo-scrubs-medical-wear','Illustrative category for authentic Gileo Scrubs listings.',now(),now()),
(gen_random_uuid(),'Medical Accessories','medical-accessories','Demo category; confirm inventory before launch.',now(),now()),
(gen_random_uuid(),'Medical Equipment','medical-equipment','Demo category; confirm inventory before launch.',now(),now()),
(gen_random_uuid(),'Medical Supplies','medical-supplies','Demo category; confirm inventory before launch.',now(),now())
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO services ("id","slug","title","description","audience","whatIsIncluded","priceKobo","priceLabel","isIndicative","status","createdAt","updatedAt")
VALUES
(gen_random_uuid(),'home-care-wound-dressing','Home-service wound dressing','Illustrative demo service for a home visit. GILEO must confirm suitability, availability, and final pricing before booking.','People requiring an at-home wound dressing service.','A service request, availability review, and follow-up onboarding after payment verification. Do not submit sensitive clinical details at this stage.',2000000,'Illustrative estimate: ₦20,000 per session — confirm with GILEO',true,'PUBLISHED',now(),now()),
(gen_random_uuid(),'elderly-care-recovery','Elderly care and post-hospital recovery support','Request information about in-home support after illness or hospital discharge. Availability and care plan require GILEO review.','Families and individuals needing support at home.','Initial request and follow-up by the GILEO team.',NULL,'Pricing confirmed after review',true,'PUBLISHED',now(),now()),
(gen_random_uuid(),'event-medical-coverage','Event medical coverage','Request medical coverage for an event. Team size and price depend on event details and availability.','Event organisers and institutions.','Request review and quote.',NULL,'Quote required',true,'PUBLISHED',now(),now()),
(gen_random_uuid(),'corporate-health-coverage','Corporate and organisational medical coverage','Request healthcare coverage for an organisation. Scope and pricing are confirmed after consultation.','Companies, organisations, and institutions.','Request review and quote.',NULL,'Quote required',true,'PUBLISHED',now(),now())
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO ebooks ("id","slug","title","description","author","priceKobo","priceLabel","isIndicative","currency","isDemo","status","createdAt","updatedAt")
VALUES
(gen_random_uuid(),'become-a-nurse-concierge','How to Become a Nurse Concierge','Proposed Learning Hub title. Replace this description and attach the approved digital file before sale.','Gileo Medicals',500000,'Demo estimate: ₦5,000 — confirm with GILEO',true,'NGN',true,'PUBLISHED',now(),now()),
(gen_random_uuid(),'professional-nursing-portfolio','How to Build a Professional Nursing Portfolio','Proposed Learning Hub title. Demo listing only; add approved content and price before public sale.','Gileo Medicals',500000,'Demo estimate: ₦5,000 — confirm with GILEO',true,'NGN',true,'PUBLISHED',now(),now()),
(gen_random_uuid(),'nursing-leadership-presentation','How to Present Yourself Professionally as a Nursing Leader','Proposed Learning Hub title. Demo listing only; add approved content and price before public sale.','Gileo Medicals',500000,'Demo estimate: ₦5,000 — confirm with GILEO',true,'NGN',true,'PUBLISHED',now(),now()),
(gen_random_uuid(),'nursing-leadership-career','How to Build a Career in Nursing Leadership','Proposed Learning Hub title. Demo listing only; add approved content and price before public sale.','Gileo Medicals',500000,'Demo estimate: ₦5,000 — confirm with GILEO',true,'NGN',true,'PUBLISHED',now(),now()),
(gen_random_uuid(),'global-nursing-careers','Global Nursing Careers and Opportunities','Working title supplied in the brief. Confirm title, content, and pricing before public launch.','Gileo Medicals',500000,'Demo estimate: ₦5,000 — confirm with GILEO',true,'NGN',true,'PUBLISHED',now(),now())
ON CONFLICT ("slug") DO NOTHING;
