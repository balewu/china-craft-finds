# China Craft Finds — first website version

A small catalogue + cart + manual quote request website.

## What this version does

- Public product catalogue with categories and search
- SKU/variation selection and shopping bag
- Customer submits delivery details; **no payment is collected**
- Supabase creates an order number and saves item/price snapshots
- Admin sign-in, product/SKU editing and order status updates
- Customers cannot query the orders table; only admins can view customer details

## Important before accepting real orders

1. Have an eligible adult/guardian manage the real platform accounts, business activity and payment account where required by platform rules.
2. Do not put a Supabase `service_role` key in this website. Only use the anon/publishable key.
3. Review privacy requirements for the countries where customers live. Collect only information needed to fulfil orders, restrict admin access, and define when old customer data is deleted.
4. This starter does not include inventory reservation, email notifications, shipping calculation, or PayPal checkout.
5. The sample catalogue is demo content. Replace it with products you are authorised to sell/source and accurate prices.
6. Before launch, test with fake customer details and delete the test records.

## Part A — Create your Supabase project

1. Go to https://supabase.com/ and create a project.
2. In the project dashboard, open **SQL Editor** → **New query**.
3. Open `supabase.sql` from this project, copy all its contents into the SQL editor, and run it.
4. Open **Project Settings** → **API** (or **Data API / API Keys**, depending on the dashboard version).
5. Copy the Project URL and the anon/publishable key. Never copy the `service_role` or secret key into the website.

## Part B — Create your administrator login

1. In Supabase, open **Authentication** → **Users** → **Add user**.
2. Create an administrator email and a strong unique password. Use an adult-managed account if platform age rules require it.
3. Copy that user's UUID from the Users list.
4. Open **SQL Editor** and run this statement, replacing the example UUID:
   `insert into public.admin_users (user_id) values ('PASTE-USER-UUID-HERE');`
5. Do not share the administrator password. Turn on multi-factor authentication if available.

## Part C — Connect this website to Supabase

1. Open `app.js` in a text editor.
2. At the top, replace:
   - `YOUR_SUPABASE_PROJECT_URL` with your Project URL
   - `YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY` with your anon/publishable key
3. Save the file. Do not paste a service-role/secret key here.

## Part D — Put the files on GitHub Pages

1. Sign in to https://github.com/.
2. Click **New repository**.
3. Name it `china-craft-finds`. Choose **Public** if you want to use GitHub Pages on the free GitHub plan. Do not put private customer information, API secrets or order exports in this repository.
4. Create the repository.
5. Click **Add file** → **Upload files**.
6. Upload `index.html`, `styles.css`, `app.js`, `supabase.sql`, and `README.md` from this folder. You can upload them all together.
7. Click **Commit changes**.
8. In the repository, open **Settings** → **Pages**.
9. Under **Build and deployment**, choose **Deploy from a branch**. Choose branch `main`, folder `/ (root)`, then Save.
10. Wait for GitHub Pages to publish. Your site address will look like `https://YOUR-GITHUB-USERNAME.github.io/china-craft-finds/`.

If GitHub Pages is not offered for your repository, check the repository visibility and the current GitHub plan/settings.

## Part E — Add products

1. Open the published website.
2. Click the small **Admin** link at the bottom-right.
3. Sign in using the Supabase administrator user.
4. Click **Products** → **Add a product**.
5. Enter the product name, description, category and image URL.
6. Enter SKU variations one per line in this exact format:
   `SKU-CODE | Variation name | Price in USD`
   Example:
   `PINK-01 | Pink | 4.50`
   `BLUE-01 | Blue | 4.50`
7. Save. The product should appear in the public shop.

Use image URLs that you have permission to use and that are publicly viewable over HTTPS. For the first version, images are linked from their original host rather than uploaded to a private bucket.

## Part F — Test the order flow

1. Add one or more products to the bag.
2. Continue to request and use fake test contact details.
3. Submit the request.
4. Open Admin → Orders. Check that the order, item variations, quantity and item subtotal are present.
5. Change its status to `awaiting_payment`, for example.
6. Confirm that the public page does not expose order details.

## How to update the website

Edit the relevant file on GitHub using the pencil icon, or upload the replacement file and commit. GitHub Pages will republish after the commit.

## Current limitations

- Prices are in USD for display. The database stores integer cents.
- The order total is an **estimated item subtotal only**. Shipping, sourcing fees, taxes and any other charges are not included; confirm those manually before sending a payment request.
- Editing a product replaces its current SKU list. Existing order item snapshots remain unchanged.
- The demo preview appears if Supabase is not configured; it cannot accept real orders.
- The admin panel is intentionally basic. Add more security and operational controls before a larger launch.
