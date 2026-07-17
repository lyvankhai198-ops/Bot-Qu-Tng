
# translations.py — All bot text in Vietnamese (vi) and English (en)

LANG = {
    "vi": {
        # Language selection
        "choose_lang": "🌐 Chọn ngôn ngữ / Choose language:",
        "lang_chosen": "✅ Đã chọn Tiếng Việt!",

        # Welcome
        "welcome": (
            "🎁 <b>BOT QUÀ TẶNG AI</b>\n\n"
            "Chào mừng <b>{name}</b> đến với bot nhận quà miễn phí của AI Center.\n\n"
            "Vui lòng chọn chức năng bên dưới."
        ),
        "welcome_admin": (
            "🎁 <b>BOT QUÀ TẶNG AI</b>\n\n"
            "Chào mừng <b>Admin {name}</b>!\n\n"
            "Vui lòng chọn chức năng bên dưới."
        ),

        # Main menu buttons
        "btn_gift": "🎁 Nhận Quà",
        "btn_inventory": "📦 Kho Quà",
        "btn_rules": "📜 Quy Định",
        "btn_support": "💬 Liên Hệ Admin",
        "btn_shop": "🛍 Kênh Bán Hàng",
        "btn_refund": "💰 Tính Hoàn Tiền",
        "btn_warranty": "🛡 Bảo Hành",
        "btn_expiry": "📅 Tính Ngày Hết Hạn",
        "btn_check_warranty": "📦 Kiểm Tra Bảo Hành",
        "btn_calculator": "🧮 Máy Tính Nhanh",
        "btn_faq": "❓ FAQ",
        "btn_notify": "📢 Thông Báo",
        "btn_admin": "👑 Admin",
        "btn_back": "🔙 Quay lại",
        "btn_home": "🏠 Trang chủ",
        "btn_recalc": "🔄 Tính lại",
        "btn_open_shop": "🛍 MỞ KÊNH BÁN HÀNG",

        # Admin menu buttons
        "btn_add_account": "📦 Thêm Tài Khoản",
        "btn_del_account": "🗑 Xóa Tài Khoản",
        "btn_broadcast": "📢 Gửi Thông Báo",
        "btn_new_round": "🎁 Mở Đợt Quà Mới",
        "btn_receivers": "👥 Người Đã Nhận",
        "btn_stats": "📊 Thống Kê",
        "btn_ban": "🚫 Ban User",
        "btn_unban": "✅ Bỏ Ban",
        "btn_settings": "⚙️ Cài Đặt",
        "btn_backup": "💾 Backup Dữ Liệu",
        "btn_logs": "📋 Xem Logs",

        # Gift / Claim
        "gift_banned": "🚫 Bạn đã bị cấm sử dụng bot.",
        "gift_empty": "😔 Kho quà hiện đã hết. Hãy quay lại sau nhé!",
        "gift_already": (
            "❌ <b>Bạn đã nhận quà trước đó.</b>\n"
            "⏳ Bạn có thể nhận lại sau: <b>{h} giờ {m} phút</b>."
        ),
        "gift_already_round": (
            "❌ <b>Bạn đã nhận quà trong đợt này rồi.</b>\n"
            "Hãy chờ đợt quà mới nhé!"
        ),
        "gift_success": (
            "🎉 <b>Chúc mừng! Bạn đã nhận quà thành công.</b>\n\n"
            "📧 <b>Tài khoản:</b> <code>{email}</code>\n"
            "🔑 <b>Mật khẩu:</b> <code>{password}</code>\n\n"
            "⚠️ Mỗi người chỉ nhận quà theo quy định của bot.\n\n"
            "Nếu cần tài khoản Premium, hãy ghé:\n"
            "🛍 @shoptaikhoanaibot"
        ),
        "gift_admin_notify": (
            "🎁 <b>Có người vừa nhận quà:</b>\n"
            "👤 User: @{username}\n"
            "🆔 ID: <code>{user_id}</code>\n"
            "📧 Account: <code>{email}</code>"
        ),

        # Inventory
        "inventory_title": "📦 <b>Kho Quà</b>",
        "inventory_count": "Hiện còn <b>{count}</b> tài khoản trong kho.",
        "inventory_empty": "Kho hiện đang trống.",

        # Rules
        "rules_text": (
            "📜 <b>QUY ĐỊNH NHẬN QUÀ</b>\n\n"
            "1️⃣ Mỗi người chỉ được nhận quà <b>một lần</b> mỗi đợt.\n"
            "2️⃣ Không chia sẻ tài khoản nhận được.\n"
            "3️⃣ Không sử dụng tài khoản cho mục đích phi pháp.\n"
            "4️⃣ Vi phạm sẽ bị <b>cấm vĩnh viễn</b>.\n"
            "5️⃣ Mọi thắc mắc liên hệ Admin.\n\n"
            "✅ Nhận quà là đồng ý với các quy định trên."
        ),

        # Support
        "support_text": (
            "💬 <b>LIÊN HỆ ADMIN</b>\n\n"
            "Nếu bạn cần hỗ trợ, hãy liên hệ:\n"
            "👤 Admin: {support_username}\n\n"
            "Mô tả rõ vấn đề để được hỗ trợ nhanh nhất."
        ),

        # Refund calculator
        "refund_title": "💰 <b>TÍNH HOÀN TIỀN</b>",
        "refund_ask_price": "💰 Nhập <b>giá sản phẩm</b> (VD: 100000):",
        "refund_ask_total_days": "📅 Nhập <b>tổng số ngày</b> sử dụng (VD: 30):",
        "refund_ask_used_days": "📆 Nhập <b>số ngày đã dùng</b> (VD: 10):",
        "refund_result": (
            "💰 <b>KẾT QUẢ HOÀN TIỀN</b>\n\n"
            "💵 Giá gốc: <b>{price:,.0f}₫</b>\n"
            "📆 Đã dùng: <b>{used_days}</b> ngày\n"
            "📅 Còn lại: <b>{remaining_days}</b> ngày\n"
            "💸 Tiền hoàn: <b>{refund:,.0f}₫</b>"
        ),
        "refund_invalid": "❌ Vui lòng nhập số hợp lệ.",
        "refund_used_exceed": "❌ Số ngày đã dùng không thể lớn hơn tổng số ngày.",

        # Warranty
        "warranty_title": "🛡 <b>CHÍNH SÁCH BẢO HÀNH</b>",
        "warranty_text": (
            "🛡 <b>CHÍNH SÁCH BẢO HÀNH</b>\n\n"
            "✅ <b>Được bảo hành:</b>\n"
            "• Tài khoản không đăng nhập được\n"
            "• Tài khoản bị khóa từ phía nhà cung cấp\n"
            "• Thông tin tài khoản bị thay đổi\n\n"
            "❌ <b>Không bảo hành:</b>\n"
            "• Tài khoản bị khóa do vi phạm điều khoản\n"
            "• Lộ thông tin do người dùng tự chia sẻ\n"
            "• Quá thời hạn bảo hành\n\n"
            "⏰ <b>Thời hạn bảo hành:</b> 24 giờ kể từ khi nhận\n\n"
            "📩 Liên hệ Admin để được hỗ trợ bảo hành."
        ),

        # Expiry date calculator
        "expiry_title": "📅 <b>TÍNH NGÀY HẾT HẠN</b>",
        "expiry_ask_start": "📅 Nhập <b>ngày bắt đầu</b> (định dạng DD/MM/YYYY):",
        "expiry_ask_days": "⏳ Nhập <b>số ngày sử dụng</b>:",
        "expiry_result": (
            "📅 <b>KẾT QUẢ</b>\n\n"
            "🗓 Ngày bắt đầu: <b>{start}</b>\n"
            "⏳ Thời hạn: <b>{days}</b> ngày\n"
            "🔚 Ngày hết hạn: <b>{end}</b>"
        ),
        "expiry_invalid_date": "❌ Định dạng ngày không hợp lệ. Vui lòng nhập DD/MM/YYYY.",
        "expiry_invalid_days": "❌ Vui lòng nhập số ngày hợp lệ.",

        # Warranty check
        "warranty_check_title": "📦 <b>KIỂM TRA BẢO HÀNH</b>",
        "warranty_check_ask": "📧 Nhập <b>email tài khoản</b> cần kiểm tra:",
        "warranty_check_found": (
            "✅ <b>Tìm thấy bảo hành</b>\n\n"
            "📧 Email: <code>{email}</code>\n"
            "👤 Người nhận: {name}\n"
            "📅 Ngày nhận: {claim_time}\n"
            "🔄 Đợt: {round_id}"
        ),
        "warranty_check_not_found": "❌ Không tìm thấy thông tin bảo hành cho email này.",

        # Quick calculator
        "calc_title": "🧮 <b>MÁY TÍNH NHANH</b>",
        "calc_prompt": (
            "🧮 <b>MÁY TÍNH NHANH</b>\n\n"
            "Nhập biểu thức toán học.\n"
            "Ví dụ: <code>100 * 12 / 3 + 50</code>"
        ),
        "calc_result": "📊 Kết quả: <code>{expr}</code> = <b>{result}</b>",
        "calc_error": "❌ Biểu thức không hợp lệ. Vui lòng thử lại.",

        # FAQ
        "faq_title": "❓ <b>CÂU HỎI THƯỜNG GẶP</b>",
        "faq_text": (
            "❓ <b>CÂU HỎI THƯỜNG GẶP</b>\n\n"
            "❓ <b>Bot này làm gì?</b>\n"
            "→ Bot phát quà miễn phí (tài khoản AI) cho người dùng.\n\n"
            "❓ <b>Nhận quà bao nhiêu lần?</b>\n"
            "→ Mỗi đợt 1 lần. Admin sẽ mở đợt mới định kỳ.\n\n"
            "❓ <b>Tài khoản không dùng được?</b>\n"
            "→ Liên hệ Admin trong vòng 24h để được hỗ trợ.\n\n"
            "❓ <b>Muốn mua tài khoản premium?</b>\n"
            "→ Truy cập kênh bán hàng của chúng tôi.\n\n"
            "❓ <b>Cần hỗ trợ khác?</b>\n"
            "→ Nhấn 💬 Liên Hệ Admin."
        ),

        # Notifications
        "notify_title": "📢 <b>THÔNG BÁO</b>",
        "notify_none": "📢 Hiện chưa có thông báo nào.",

        # Admin panel
        "admin_title": "👑 <b>ADMIN PANEL</b>",
        "admin_ask_add": (
            "📦 <b>THÊM TÀI KHOẢN</b>\n\n"
            "Gửi danh sách tài khoản, mỗi dòng một tài khoản:\n"
            "<code>email:password</code>\n\n"
            "Ví dụ:\n"
            "<code>user1@gmail.com:pass123\n"
            "user2@gmail.com:pass456</code>"
        ),
        "admin_add_success": "✅ Đã thêm <b>{count}</b> tài khoản vào kho.",
        "admin_add_invalid": "⚠️ Bỏ qua <b>{count}</b> dòng không hợp lệ (phải có dạng email:password).",
        "admin_ask_del": (
            "🗑 <b>XÓA TÀI KHOẢN</b>\n\n"
            "Nhập email tài khoản cần xóa:"
        ),
        "admin_del_success": "✅ Đã xóa tài khoản: <code>{email}</code>",
        "admin_del_not_found": "❌ Không tìm thấy tài khoản: <code>{email}</code>",
        "admin_ask_broadcast": (
            "📢 <b>GỬI THÔNG BÁO</b>\n\n"
            "Nhập nội dung thông báo muốn gửi đến tất cả người dùng:"
        ),
        "admin_broadcast_sent": "✅ Đã gửi thông báo đến <b>{count}</b> người dùng.",
        "admin_broadcast_msg": "📢 <b>THÔNG BÁO TỪ ADMIN</b>\n\n{msg}",
        "admin_ask_new_round": (
            "🎁 <b>MỞ ĐỢT QUÀ MỚI</b>\n\n"
            "Nhập tên đợt quà mới (VD: dot2, round2, xmas2024):"
        ),
        "admin_new_round_success": "✅ Đã mở đợt quà mới: <b>{round_id}</b>\nTất cả lịch sử nhận quà đã được reset.",
        "admin_receivers_title": "👥 <b>DANH SÁCH NGƯỜI ĐÃ NHẬN</b>",
        "admin_receivers_empty": "Chưa có ai nhận quà trong đợt này.",
        "admin_receivers_row": "• {name} (@{username}) — <code>{email}</code>",
        "admin_stats_title": (
            "📊 <b>THỐNG KÊ</b>\n\n"
            "👥 Tổng người dùng: <b>{total_users}</b>\n"
            "🎁 Đã nhận quà đợt này: <b>{claimed}</b>\n"
            "📦 Còn trong kho: <b>{stock}</b>\n"
            "🚫 Đang bị ban: <b>{banned}</b>\n"
            "🔄 Đợt hiện tại: <b>{round_id}</b>"
        ),
        "admin_ask_ban": "🚫 Nhập <b>User ID</b> cần ban:",
        "admin_ban_success": "✅ Đã ban user <code>{user_id}</code>.",
        "admin_ban_already": "⚠️ User <code>{user_id}</code> đã bị ban rồi.",
        "admin_ask_unban": "✅ Nhập <b>User ID</b> cần bỏ ban:",
        "admin_unban_success": "✅ Đã bỏ ban user <code>{user_id}</code>.",
        "admin_unban_not_found": "⚠️ Không tìm thấy user <code>{user_id}</code> trong danh sách ban.",
        "admin_settings_title": (
            "⚙️ <b>CÀI ĐẶT</b>\n\n"
            "🔗 Shop link: {shop_link}\n"
            "👤 Shop username: {shop_username}\n"
            "💬 Support: {support_username}\n"
            "⏰ Cooldown: {cooldown_hours} giờ\n"
            "🔄 Đợt hiện tại: {round_id}\n\n"
            "Gửi lệnh để thay đổi:\n"
            "/setshop [link] — đổi link shop\n"
            "/setsupport [username] — đổi username support\n"
            "/setcooldown [giờ] — đổi cooldown (0 = mỗi đợt 1 lần)"
        ),
        "admin_backup_done": "💾 <b>Backup hoàn tất!</b> Gửi file...",
        "admin_logs_title": "📋 <b>LOGS GẦN ĐÂY</b>",
        "admin_logs_row": "• [{time}] {action} — {user}",
        "admin_logs_empty": "Chưa có log nào.",
        "admin_only": "🚫 Lệnh này chỉ dành cho Admin.",
        "cancelled": "❌ Đã hủy.",
        "unknown_cmd": "❓ Không hiểu lệnh này. Hãy dùng menu bên dưới.",
        "error": "❌ Có lỗi xảy ra. Vui lòng thử lại.",
        # Settings commands
        "setting_updated": "✅ Đã cập nhật: <b>{key}</b> = {value}",
        "setting_invalid": "❌ Cú pháp không đúng.",
    },

    "en": {
        # Language selection
        "choose_lang": "🌐 Choose language / Chọn ngôn ngữ:",
        "lang_chosen": "✅ English selected!",

        # Welcome
        "welcome": (
            "🎁 <b>AI GIFT BOT</b>\n\n"
            "Welcome <b>{name}</b> to the AI Center free gift bot.\n\n"
            "Please select a feature below."
        ),
        "welcome_admin": (
            "🎁 <b>AI GIFT BOT</b>\n\n"
            "Welcome <b>Admin {name}</b>!\n\n"
            "Please select a feature below."
        ),

        # Main menu buttons
        "btn_gift": "🎁 Claim Gift",
        "btn_inventory": "📦 Gift Stock",
        "btn_rules": "📜 Rules",
        "btn_support": "💬 Contact Admin",
        "btn_shop": "🛍 Shop Channel",
        "btn_refund": "💰 Refund Calculator",
        "btn_warranty": "🛡 Warranty",
        "btn_expiry": "📅 Expiry Date",
        "btn_check_warranty": "📦 Check Warranty",
        "btn_calculator": "🧮 Quick Calculator",
        "btn_faq": "❓ FAQ",
        "btn_notify": "📢 Announcements",
        "btn_admin": "👑 Admin",
        "btn_back": "🔙 Back",
        "btn_home": "🏠 Home",
        "btn_recalc": "🔄 Recalculate",
        "btn_open_shop": "🛍 OPEN SHOP CHANNEL",

        # Admin menu buttons
        "btn_add_account": "📦 Add Account",
        "btn_del_account": "🗑 Delete Account",
        "btn_broadcast": "📢 Send Announcement",
        "btn_new_round": "🎁 New Giveaway Round",
        "btn_receivers": "👥 Gift Recipients",
        "btn_stats": "📊 Statistics",
        "btn_ban": "🚫 Ban User",
        "btn_unban": "✅ Unban User",
        "btn_settings": "⚙️ Settings",
        "btn_backup": "💾 Backup Data",
        "btn_logs": "📋 View Logs",

        # Gift / Claim
        "gift_banned": "🚫 You have been banned from using this bot.",
        "gift_empty": "😔 Gift stock is currently empty. Please check back later!",
        "gift_already": (
            "❌ <b>You have already claimed a gift before.</b>\n"
            "⏳ You can claim again in: <b>{h}h {m}m</b>."
        ),
        "gift_already_round": (
            "❌ <b>You have already claimed a gift this round.</b>\n"
            "Please wait for the next giveaway round!"
        ),
        "gift_success": (
            "🎉 <b>Congratulations! You have claimed your gift successfully.</b>\n\n"
            "📧 <b>Account:</b> <code>{email}</code>\n"
            "🔑 <b>Password:</b> <code>{password}</code>\n\n"
            "⚠️ Each user may only claim once per the bot's rules.\n\n"
            "For Premium accounts, visit:\n"
            "🛍 @shoptaikhoanaibot"
        ),
        "gift_admin_notify": (
            "🎁 <b>Someone just claimed a gift:</b>\n"
            "👤 User: @{username}\n"
            "🆔 ID: <code>{user_id}</code>\n"
            "📧 Account: <code>{email}</code>"
        ),

        # Inventory
        "inventory_title": "📦 <b>Gift Stock</b>",
        "inventory_count": "Currently <b>{count}</b> accounts in stock.",
        "inventory_empty": "Stock is currently empty.",

        # Rules
        "rules_text": (
            "📜 <b>GIFT RULES</b>\n\n"
            "1️⃣ Each user may only claim <b>once</b> per round.\n"
            "2️⃣ Do not share the received account credentials.\n"
            "3️⃣ Do not use accounts for illegal purposes.\n"
            "4️⃣ Violations will result in a <b>permanent ban</b>.\n"
            "5️⃣ For any questions, contact Admin.\n\n"
            "✅ Claiming a gift means you agree to the above rules."
        ),

        # Support
        "support_text": (
            "💬 <b>CONTACT ADMIN</b>\n\n"
            "If you need support, please reach out:\n"
            "👤 Admin: {support_username}\n\n"
            "Describe your issue clearly for the fastest response."
        ),

        # Refund calculator
        "refund_title": "💰 <b>REFUND CALCULATOR</b>",
        "refund_ask_price": "💰 Enter the <b>product price</b> (e.g. 100000):",
        "refund_ask_total_days": "📅 Enter the <b>total subscription days</b> (e.g. 30):",
        "refund_ask_used_days": "📆 Enter the <b>days used</b> (e.g. 10):",
        "refund_result": (
            "💰 <b>REFUND RESULT</b>\n\n"
            "💵 Original price: <b>{price:,.0f}</b>\n"
            "📆 Days used: <b>{used_days}</b>\n"
            "📅 Days remaining: <b>{remaining_days}</b>\n"
            "💸 Refund amount: <b>{refund:,.0f}</b>"
        ),
        "refund_invalid": "❌ Please enter a valid number.",
        "refund_used_exceed": "❌ Days used cannot exceed total days.",

        # Warranty
        "warranty_title": "🛡 <b>WARRANTY POLICY</b>",
        "warranty_text": (
            "🛡 <b>WARRANTY POLICY</b>\n\n"
            "✅ <b>Covered under warranty:</b>\n"
            "• Account cannot be logged into\n"
            "• Account locked by the provider\n"
            "• Account credentials changed\n\n"
            "❌ <b>Not covered:</b>\n"
            "• Account locked due to terms violation\n"
            "• Credentials leaked by the user\n"
            "• Expired warranty period\n\n"
            "⏰ <b>Warranty period:</b> 24 hours from receipt\n\n"
            "📩 Contact Admin for warranty support."
        ),

        # Expiry date calculator
        "expiry_title": "📅 <b>EXPIRY DATE CALCULATOR</b>",
        "expiry_ask_start": "📅 Enter the <b>start date</b> (format DD/MM/YYYY):",
        "expiry_ask_days": "⏳ Enter the <b>number of days</b>:",
        "expiry_result": (
            "📅 <b>RESULT</b>\n\n"
            "🗓 Start date: <b>{start}</b>\n"
            "⏳ Duration: <b>{days}</b> days\n"
            "🔚 Expiry date: <b>{end}</b>"
        ),
        "expiry_invalid_date": "❌ Invalid date format. Please enter DD/MM/YYYY.",
        "expiry_invalid_days": "❌ Please enter a valid number of days.",

        # Warranty check
        "warranty_check_title": "📦 <b>WARRANTY CHECK</b>",
        "warranty_check_ask": "📧 Enter the <b>account email</b> to check:",
        "warranty_check_found": (
            "✅ <b>Warranty found</b>\n\n"
            "📧 Email: <code>{email}</code>\n"
            "👤 Recipient: {name}\n"
            "📅 Claim date: {claim_time}\n"
            "🔄 Round: {round_id}"
        ),
        "warranty_check_not_found": "❌ No warranty information found for this email.",

        # Quick calculator
        "calc_title": "🧮 <b>QUICK CALCULATOR</b>",
        "calc_prompt": (
            "🧮 <b>QUICK CALCULATOR</b>\n\n"
            "Enter a math expression.\n"
            "Example: <code>100 * 12 / 3 + 50</code>"
        ),
        "calc_result": "📊 Result: <code>{expr}</code> = <b>{result}</b>",
        "calc_error": "❌ Invalid expression. Please try again.",

        # FAQ
        "faq_title": "❓ <b>FREQUENTLY ASKED QUESTIONS</b>",
        "faq_text": (
            "❓ <b>FREQUENTLY ASKED QUESTIONS</b>\n\n"
            "❓ <b>What does this bot do?</b>\n"
            "→ The bot distributes free gifts (AI accounts) to users.\n\n"
            "❓ <b>How many times can I claim?</b>\n"
            "→ Once per round. Admin opens new rounds periodically.\n\n"
            "❓ <b>Account not working?</b>\n"
            "→ Contact Admin within 24 hours for support.\n\n"
            "❓ <b>Want a premium account?</b>\n"
            "→ Visit our shop channel.\n\n"
            "❓ <b>Need other help?</b>\n"
            "→ Tap 💬 Contact Admin."
        ),

        # Notifications
        "notify_title": "📢 <b>ANNOUNCEMENTS</b>",
        "notify_none": "📢 No announcements at the moment.",

        # Admin panel
        "admin_title": "👑 <b>ADMIN PANEL</b>",
        "admin_ask_add": (
            "📦 <b>ADD ACCOUNTS</b>\n\n"
            "Send the account list, one per line:\n"
            "<code>email:password</code>\n\n"
            "Example:\n"
            "<code>user1@gmail.com:pass123\n"
            "user2@gmail.com:pass456</code>"
        ),
        "admin_add_success": "✅ Added <b>{count}</b> accounts to stock.",
        "admin_add_invalid": "⚠️ Skipped <b>{count}</b> invalid lines (must be email:password format).",
        "admin_ask_del": (
            "🗑 <b>DELETE ACCOUNT</b>\n\n"
            "Enter the email of the account to delete:"
        ),
        "admin_del_success": "✅ Deleted account: <code>{email}</code>",
        "admin_del_not_found": "❌ Account not found: <code>{email}</code>",
        "admin_ask_broadcast": (
            "📢 <b>SEND ANNOUNCEMENT</b>\n\n"
            "Enter the message to broadcast to all users:"
        ),
        "admin_broadcast_sent": "✅ Announcement sent to <b>{count}</b> users.",
        "admin_broadcast_msg": "📢 <b>ANNOUNCEMENT FROM ADMIN</b>\n\n{msg}",
        "admin_ask_new_round": (
            "🎁 <b>NEW GIVEAWAY ROUND</b>\n\n"
            "Enter the name for the new round (e.g. round2, xmas2024):"
        ),
        "admin_new_round_success": "✅ New round opened: <b>{round_id}</b>\nAll claim history has been reset.",
        "admin_receivers_title": "👥 <b>GIFT RECIPIENTS</b>",
        "admin_receivers_empty": "No one has claimed a gift this round.",
        "admin_receivers_row": "• {name} (@{username}) — <code>{email}</code>",
        "admin_stats_title": (
            "📊 <b>STATISTICS</b>\n\n"
            "👥 Total users: <b>{total_users}</b>\n"
            "🎁 Claimed this round: <b>{claimed}</b>\n"
            "📦 Stock remaining: <b>{stock}</b>\n"
            "🚫 Banned: <b>{banned}</b>\n"
            "🔄 Current round: <b>{round_id}</b>"
        ),
        "admin_ask_ban": "🚫 Enter the <b>User ID</b> to ban:",
        "admin_ban_success": "✅ Banned user <code>{user_id}</code>.",
        "admin_ban_already": "⚠️ User <code>{user_id}</code> is already banned.",
        "admin_ask_unban": "✅ Enter the <b>User ID</b> to unban:",
        "admin_unban_success": "✅ Unbanned user <code>{user_id}</code>.",
        "admin_unban_not_found": "⚠️ User <code>{user_id}</code> not found in ban list.",
        "admin_settings_title": (
            "⚙️ <b>SETTINGS</b>\n\n"
            "🔗 Shop link: {shop_link}\n"
            "👤 Shop username: {shop_username}\n"
            "💬 Support: {support_username}\n"
            "⏰ Cooldown: {cooldown_hours} hours\n"
            "🔄 Current round: {round_id}\n\n"
            "Send commands to change:\n"
            "/setshop [link] — change shop link\n"
            "/setsupport [username] — change support username\n"
            "/setcooldown [hours] — change cooldown (0 = once per round)"
        ),
        "admin_backup_done": "💾 <b>Backup complete!</b> Sending files...",
        "admin_logs_title": "📋 <b>RECENT LOGS</b>",
        "admin_logs_row": "• [{time}] {action} — {user}",
        "admin_logs_empty": "No logs yet.",
        "admin_only": "🚫 This command is for Admins only.",
        "cancelled": "❌ Cancelled.",
        "unknown_cmd": "❓ Command not recognized. Please use the menu below.",
        "error": "❌ An error occurred. Please try again.",
        "setting_updated": "✅ Updated: <b>{key}</b> = {value}",
        "setting_invalid": "❌ Invalid syntax.",
    }
}


def t(lang: str, key: str, **kwargs) -> str:
    """Get translated string for given language and key."""
    text = LANG.get(lang, LANG["vi"]).get(key, LANG["vi"].get(key, key))
    if kwargs:
        try:
            return text.format(**kwargs)
        except (KeyError, ValueError):
            return text
    return text
