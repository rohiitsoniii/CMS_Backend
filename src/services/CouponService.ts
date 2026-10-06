import { Coupon, ICoupon } from '../models/Coupon.js';
import { AppError } from '../middleware/errorHandler.js';

export class CouponService {
  /**
   * Validate a coupon code for a specific plan
   */
  static async validateCoupon(code: string, planSlug: string, amount: number): Promise<ICoupon> {
    const coupon = await Coupon.findOne({ code: code.toUpperCase(), isActive: true });

    if (!coupon) {
      throw new AppError('Invalid or inactive coupon code', 400);
    }

    if (!coupon.isValid()) {
      throw new AppError('Coupon has expired or reached usage limit', 400);
    }

    if (coupon.minAmount && amount < coupon.minAmount) {
      throw new AppError(`Coupon requires a minimum purchase of ${coupon.minAmount}`, 400);
    }

    if (coupon.applicablePlans.length > 0 && !coupon.applicablePlans.includes(planSlug)) {
      throw new AppError('Coupon is not applicable to this plan', 400);
    }

    return coupon;
  }

  /**
   * Calculate discounted amount
   */
  static calculateDiscount(coupon: ICoupon, originalAmount: number): number {
    if (coupon.discountType === 'percentage') {
      const discount = (originalAmount * coupon.value) / 100;
      return Math.max(0, originalAmount - discount);
    } else {
      return Math.max(0, originalAmount - coupon.value);
    }
  }

  /**
   * Record coupon usage
   */
  static async incrementUsage(code: string): Promise<void> {
    await Coupon.findOneAndUpdate(
      { code: code.toUpperCase() },
      { $inc: { usedCount: 1 } }
    );
  }
}
